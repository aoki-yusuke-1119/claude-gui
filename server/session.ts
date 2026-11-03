import { randomUUID } from 'node:crypto'

import {
  type CanUseTool,
  getSessionInfo,
  getSessionMessages,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  query,
  renameSession,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'

import type {
  DisplayItem,
  PermissionDecision,
  PermissionModeOption,
  PermissionRequest,
  TabInfo,
  TabLiveState,
} from '../shared/protocol'
import { convertHistoryMessage, convertSdkMessage, notice } from './convert'
import { errorMessage, HttpError } from './errors'
import { broadcast } from './hub'
import { repoPath } from './repos'
import type { TabStore } from './tabs'

// 応答完了後この時間やり取りがなければ CLI プロセスを終了する（次の送信時に resume で再開する）
const IDLE_CLOSE_MS = 30 * 60 * 1000
const HISTORY_LIMIT = 1000

export const PERMISSION_MODES: PermissionModeOption[] = ['default', 'acceptEdits', 'auto', 'plan']

export function isPermissionMode(value: unknown): value is PermissionModeOption {
  return PERMISSION_MODES.includes(value as PermissionModeOption)
}

// query() に渡す入力ストリーム。送信のたびに push し、CLI プロセスは会話をまたいで使い回す
export class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = []
  private waiter: ((result: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  push(message: SDKUserMessage): void {
    if (this.waiter) {
      this.waiter({ value: message, done: false })
      this.waiter = null
    } else {
      this.items.push(message)
    }
  }

  close(): void {
    this.closed = true
    this.waiter?.({ value: undefined, done: true })
    this.waiter = null
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.waiter = resolve))
      },
    }
  }
}

interface Running {
  query: Query
  queue: MessageQueue
  closing: boolean
}

interface PendingPermission {
  request: PermissionRequest
  input: Record<string, unknown>
  suggestions: PermissionUpdate[] | undefined
  finish: (result: PermissionResult) => void
}

export class ChatSession {
  private items: DisplayItem[] = []
  private loading: Promise<void> | null = null
  private busy = false
  private streaming = ''
  private running: Running | null = null
  private readonly pending = new Map<string, PendingPermission>()
  private idleTimer: NodeJS.Timeout | null = null
  // バックグラウンドで動いている Bash・エージェントの数（CLI プロセスごと）
  private backgroundTasks = 0
  // CLI からセッション状態（idle / running）の通知が届くか
  private stateEvents = false

  constructor(
    readonly tabId: string,
    private readonly store: TabStore,
    private readonly onTurnEnd: (query: Query) => void
  ) {}

  get isActive(): boolean {
    return this.running !== null
  }

  get activeQuery(): Query | null {
    return this.running?.query ?? null
  }

  private get tab(): TabInfo {
    const tab = this.store.get(this.tabId)
    if (!tab) throw new HttpError(404, `タブが見つかりません: ${this.tabId}`)
    return tab
  }

  async snapshot(): Promise<TabLiveState> {
    await this.ensureLoaded()
    return {
      items: this.items,
      busy: this.busy,
      streaming: this.streaming,
      pending: [...this.pending.values()].map((p) => p.request),
    }
  }

  async send(text: string): Promise<void> {
    await this.ensureLoaded()
    this.clearIdleTimer()
    this.append([{ kind: 'user', id: `local:${randomUUID()}`, text }])
    // 終了処理中の CLI に送ると届かずに消えるので、その場合は起動し直す
    const running = this.running && !this.running.closing ? this.running : this.start()
    running.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    })
    this.setBusy(true)
  }

  async interrupt(): Promise<void> {
    if (!this.running || !this.busy) return
    for (const p of [...this.pending.values()]) {
      p.finish({ behavior: 'deny', message: 'ユーザーが中断しました', interrupt: true })
    }
    try {
      await this.running.query.interrupt()
    } catch (error) {
      console.error(`[${this.tabId}] 中断に失敗しました`, error)
    }
    this.resetStreaming()
    this.setBusy(false)
  }

  respondPermission(requestId: string, decision: PermissionDecision): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    if (decision.behavior === 'deny') {
      const message = decision.message?.trim()
      // 理由なしの拒否は CLI の「いいえ」と同じく、そのターンを止めて指示を待つ
      pending.finish(
        message
          ? { behavior: 'deny', message }
          : { behavior: 'deny', message: 'ユーザーが拒否しました', interrupt: true }
      )
      return
    }
    pending.finish({
      behavior: 'allow',
      updatedInput: decision.answers
        ? { ...pending.input, answers: decision.answers }
        : pending.input,
      updatedPermissions: decision.always ? pending.suggestions : undefined,
    })
  }

  async setPermissionMode(mode: PermissionModeOption): Promise<void> {
    this.store.update(this.tabId, { permissionMode: mode })
    await this.running?.query.setPermissionMode(mode)
  }

  async rename(title: string): Promise<void> {
    const { sessionId, repo } = this.tab
    if (sessionId) await renameSession(sessionId, title, { dir: repoPath(repo) })
    this.store.update(this.tabId, { title, titleByUser: true })
  }

  close(): void {
    this.clearIdleTimer()
    if (!this.running) return
    this.running.closing = true
    this.running.query.close()
  }

  private ensureLoaded(): Promise<void> {
    this.loading ??= this.loadHistory()
    return this.loading
  }

  private async loadHistory(): Promise<void> {
    const { sessionId, repo } = this.tab
    if (!sessionId) return
    try {
      const messages = await getSessionMessages(sessionId, { dir: repoPath(repo) })
      let history = messages.flatMap(convertHistoryMessage)
      if (history.length > HISTORY_LIMIT) {
        history = [
          notice(`古いメッセージ ${history.length - HISTORY_LIMIT} 件は表示を省略しています`),
          ...history.slice(-HISTORY_LIMIT),
        ]
      }
      this.items = [...history, ...this.items]
    } catch (error) {
      this.items = [
        notice(`履歴の読み込みに失敗しました: ${errorMessage(error)}`, 'error'),
        ...this.items,
      ]
    }
  }

  private start(): Running {
    const tab = this.tab
    const queue = new MessageQueue()
    const running: Running = {
      query: query({
        prompt: queue,
        options: {
          cwd: repoPath(tab.repo),
          resume: tab.sessionId ?? undefined,
          // セッション開始前にユーザーが名前を付けていれば自動命名の代わりに使う
          title: !tab.sessionId && tab.titleByUser && tab.title ? tab.title : undefined,
          permissionMode: tab.permissionMode,
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          includePartialMessages: true,
          canUseTool: this.canUseTool,
          stderr: (data) => process.stderr.write(`[${this.tabId.slice(0, 8)}] ${data}`),
          // ターンの終わり（キュー内の次のターンやバックグラウンド処理を含む）を正確に知るため
          env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' },
        },
      }),
      queue,
      closing: false,
    }
    this.running = running
    this.backgroundTasks = 0
    void this.consume(running)
    return running
  }

  private async consume(running: Running): Promise<void> {
    try {
      for await (const message of running.query) this.handle(message)
    } catch (error) {
      if (!running.closing) {
        this.append([
          notice(`Claude の実行でエラーが発生しました: ${errorMessage(error)}`, 'error'),
        ])
      }
    } finally {
      if (this.running === running) {
        this.running = null
        running.queue.close()
        for (const p of [...this.pending.values()]) {
          p.finish({ behavior: 'deny', message: 'セッションが終了しました' })
        }
        this.resetStreaming()
        this.setBusy(false)
      }
    }
  }

  private handle(message: SDKMessage): void {
    const tab = this.store.get(this.tabId)
    // タブを閉じた後に届いた残りのメッセージは捨てる
    if (!tab) return
    switch (message.type) {
      case 'stream_event':
        this.handleStream(message)
        return
      case 'assistant':
        if (message.parent_tool_use_id === null) this.resetStreaming()
        break
      case 'result':
        this.resetStreaming()
        // 状態通知が届く CLI では、キューに残った次のターンが続くことがあるので idle 通知を待つ
        if (!this.stateEvents) this.setBusy(false)
        this.scheduleIdleClose()
        void this.syncTitle()
        if (this.running) this.onTurnEnd(this.running.query)
        break
      case 'system':
        if (message.subtype === 'init' && message.session_id !== tab.sessionId) {
          this.store.update(this.tabId, { sessionId: message.session_id })
        }
        // ExitPlanMode の承認などで CLI 側のモードが変わったら追従する
        if (
          message.subtype === 'status' &&
          isPermissionMode(message.permissionMode) &&
          message.permissionMode !== tab.permissionMode
        ) {
          this.store.update(this.tabId, { permissionMode: message.permissionMode })
        }
        if (message.subtype === 'session_state_changed') {
          this.stateEvents = true
          this.setBusy(message.state !== 'idle')
        }
        if (message.subtype === 'background_tasks_changed') {
          this.backgroundTasks = message.tasks.length
        }
        break
    }
    const items = convertSdkMessage(message)
    if (items.length > 0) this.append(items)
  }

  private handleStream(message: SDKPartialAssistantMessage): void {
    if (message.parent_tool_use_id !== null) return
    const event = message.event as { type: string; delta?: { type: string; text?: string } }
    if (event.type === 'content_block_start') {
      this.resetStreaming()
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const delta = event.delta.text ?? ''
      this.streaming += delta
      broadcast({ type: 'stream', tabId: this.tabId, delta })
    }
  }

  private canUseTool: CanUseTool = (toolName, input, options) =>
    new Promise((resolve) => {
      const requestId = randomUUID()
      const request: PermissionRequest = {
        requestId,
        toolName,
        input,
        title: options.title ?? null,
        description: options.description ?? options.decisionReason ?? null,
        canAlwaysAllow: !options.suppressAlwaysAllowRule && (options.suggestions?.length ?? 0) > 0,
      }
      const finish = (result: PermissionResult) => {
        if (!this.pending.delete(requestId)) return
        broadcast({ type: 'permission_resolved', tabId: this.tabId, requestId })
        resolve(result)
      }
      this.pending.set(requestId, { request, input, suggestions: options.suggestions, finish })
      options.signal.addEventListener(
        'abort',
        () => finish({ behavior: 'deny', message: '中断されました' }),
        { once: true }
      )
      broadcast({ type: 'permission', tabId: this.tabId, request })
    })

  // 自動命名の結果をタブに反映する。ユーザーが付けた名前は、セッション ID が決まる前に付けた場合や
  // 自動命名に上書きされた場合にセッションファイルへ反映されていないので書き戻す
  private async syncTitle(): Promise<void> {
    try {
      const tab = this.store.get(this.tabId)
      if (!tab?.sessionId) return
      const dir = repoPath(tab.repo)
      const info = await getSessionInfo(tab.sessionId, { dir })
      if (tab.titleByUser) {
        if (tab.title && info?.customTitle !== tab.title) {
          await renameSession(tab.sessionId, tab.title, { dir })
        }
      } else if (info?.summary && info.summary !== tab.title) {
        this.store.update(this.tabId, { title: info.summary })
      }
    } catch (error) {
      console.error(`[${this.tabId}] セッション名の同期に失敗しました`, error)
    }
  }

  private append(items: DisplayItem[]): void {
    this.items.push(...items)
    broadcast({ type: 'items', tabId: this.tabId, items })
  }

  private setBusy(busy: boolean): void {
    if (this.busy === busy) return
    this.busy = busy
    broadcast({ type: 'busy', tabId: this.tabId, busy })
  }

  private resetStreaming(): void {
    if (!this.streaming) return
    this.streaming = ''
    broadcast({ type: 'stream_reset', tabId: this.tabId })
  }

  private scheduleIdleClose(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      // 実行中のターンやバックグラウンド処理があれば終了させず、時間をおいて再確認する
      if (this.busy || this.pending.size > 0 || this.backgroundTasks > 0) this.scheduleIdleClose()
      else this.close()
    }, IDLE_CLOSE_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, ChatSession>()

  constructor(
    private readonly store: TabStore,
    private readonly onTurnEnd: (query: Query) => void
  ) {}

  get(tabId: string): ChatSession {
    if (!this.store.get(tabId)) throw new HttpError(404, `タブが見つかりません: ${tabId}`)
    let session = this.sessions.get(tabId)
    if (!session) {
      session = new ChatSession(tabId, this.store, this.onTurnEnd)
      this.sessions.set(tabId, session)
    }
    return session
  }

  isActive(tabId: string): boolean {
    return this.sessions.get(tabId)?.isActive ?? false
  }

  anyActiveQuery(): Query | null {
    for (const session of this.sessions.values()) {
      if (session.activeQuery) return session.activeQuery
    }
    return null
  }

  close(tabId: string): void {
    this.sessions.get(tabId)?.close()
    this.sessions.delete(tabId)
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.close()
  }
}

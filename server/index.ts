import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

import { getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk'
import { type WebSocket, WebSocketServer } from 'ws'

import type { ClientMessage, PastSession, TabInfo } from '../shared/protocol'
import { CommandCatalog } from './commands'
import { DATA_FILE, DIST_DIR, PORT, ROOT_DIR } from './config'
export { ROOT_DIR }
import { errorMessage, HttpError } from './errors'
import { addClient, broadcast, sendTo } from './hub'
import { assertRepo, listRepos, listTree, openEntry, repoPath, trashEntry } from './repos'
import { isPermissionMode, SessionManager } from './session'
import { TabStore } from './tabs'
import { TerminalManager } from './terminal'
import { UsageMonitor } from './usage'

const store: TabStore = new TabStore(DATA_FILE, () =>
  broadcast({ type: 'tabs', tabs: store.list() })
)
const usage: UsageMonitor = new UsageMonitor(() => sessions.anyActiveQuery())
const sessions = new SessionManager(store, (query) => usage.onTurnEnd(query))
const terminals = new TerminalManager()
const commands = new CommandCatalog((repo) => sessions.activeQueryIn(repo))

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])
// 開発時（yarn dev）だけ Vite の画面（vite.config.ts の server.port）からの接続も許可する
const DEV_PORT = 5173
const ALLOWED_PORTS = new Set(
  process.env.CLAUDE_GUI_DEV === '1' ? [String(PORT), String(DEV_PORT)] : [String(PORT)]
)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 1024 * 1024
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

function isAllowedHost(value: string): boolean {
  const url = new URL(value)
  return LOCAL_HOSTNAMES.has(url.hostname) && ALLOWED_PORTS.has(url.port)
}

// このサーバーは Claude にコマンドを実行させられるため、DNS リバインディングや、他サイト・
// localhost の別ポートで動くページからの WebSocket / POST を拒否し、このアプリの画面からのみ受け付ける。
// Origin の付かない GET（画像の読み込みなど）も、ブラウザが付ける Sec-Fetch-Site で他のページからのものを拒否する。
// どちらもないのはブラウザ以外（ローカルのプロセス）からのアクセスなので許可する
function isLocalRequest(req: http.IncomingMessage): boolean {
  try {
    if (!isAllowedHost(`http://${req.headers.host}`)) return false
    // same-origin はこの画面から、none はアドレスバーへの直接入力
    const site = req.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
    const origin = req.headers.origin
    return !origin || (origin.startsWith('http://') && isAllowedHost(origin))
  } catch {
    return false
  }
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'リクエストが大きすぎます')
    chunks.push(chunk as Buffer)
  }
  if (size === 0) return {}
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!body || typeof body !== 'object')
    throw new HttpError(400, 'JSON オブジェクトを送ってください')
  return body as Record<string, unknown>
}

function stringParam(url: URL, name: string): string {
  return url.searchParams.get(name) ?? ''
}

async function createTab(body: Record<string, unknown>): Promise<TabInfo> {
  const repo = String(body.repo ?? '')
  await assertRepo(repo)
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null
  if (sessionId !== null && !UUID_PATTERN.test(sessionId)) {
    throw new HttpError(400, '不正なセッション ID です')
  }
  const existing = sessionId ? store.list().find((t) => t.sessionId === sessionId) : undefined
  if (existing) return existing
  const info = sessionId ? await getSessionInfo(sessionId, { dir: repoPath(repo) }) : undefined
  if (sessionId && !info) throw new HttpError(404, 'セッションが見つかりません')
  const tab: TabInfo = {
    id: randomUUID(),
    repo,
    sessionId,
    title: info?.summary ?? null,
    titleByUser: false,
    permissionMode: isPermissionMode(body.permissionMode) ? body.permissionMode : 'auto',
    createdAt: Date.now(),
  }
  store.add(tab)
  return tab
}

async function updateTab(id: string, body: Record<string, unknown>): Promise<TabInfo | undefined> {
  const tab = store.get(id)
  if (!tab) throw new HttpError(404, 'タブが見つかりません')
  if (typeof body.repo === 'string' && body.repo !== tab.repo) {
    if (tab.sessionId || sessions.isActive(id)) {
      throw new HttpError(409, 'セッション開始後はリポジトリを変更できません')
    }
    await assertRepo(body.repo)
    // ターミナルは元のリポジトリで動いているので終了し、画面側が新しいリポジトリで開き直す
    terminals.kill(id)
    store.update(id, { repo: body.repo })
  }
  if (typeof body.title === 'string') {
    const title = body.title.trim().slice(0, 200)
    if (!title) throw new HttpError(400, '名前を入力してください')
    await sessions.get(id).rename(title)
  }
  if (body.permissionMode !== undefined) {
    if (!isPermissionMode(body.permissionMode)) throw new HttpError(400, '不正な権限モードです')
    await sessions.get(id).setPermissionMode(body.permissionMode)
  }
  return store.get(id)
}

async function handleApi(req: http.IncomingMessage, url: URL): Promise<unknown> {
  const method = req.method ?? 'GET'
  const route = url.pathname

  if (method === 'GET' && route === '/api/repos') {
    return { root: ROOT_DIR, repos: await listRepos() }
  }
  if (method === 'GET' && route === '/api/tree') {
    const repo = stringParam(url, 'repo')
    await assertRepo(repo)
    return { entries: await listTree(repo, stringParam(url, 'path')) }
  }
  if (method === 'POST' && (route === '/api/files/open' || route === '/api/files/trash')) {
    const body = await readJson(req)
    const repo = String(body.repo ?? '')
    const relPath = String(body.path ?? '')
    await assertRepo(repo)
    if (route === '/api/files/open') return { ok: true, ...(await openEntry(repo, relPath)) }
    await trashEntry(repo, relPath)
    return { ok: true }
  }
  if (method === 'GET' && route === '/api/commands') {
    const repo = stringParam(url, 'repo')
    await assertRepo(repo)
    return { commands: await commands.list(repo) }
  }
  if (method === 'GET' && route === '/api/sessions') {
    const repo = stringParam(url, 'repo')
    await assertRepo(repo)
    const infos = await listSessions({ dir: repoPath(repo), limit: 50, includeWorktrees: false })
    const sessionsList: PastSession[] = infos.map((info) => ({
      sessionId: info.sessionId,
      title: info.summary,
      lastModified: info.lastModified,
      openTabId: store.list().find((t) => t.sessionId === info.sessionId)?.id ?? null,
    }))
    return { sessions: sessionsList }
  }
  if (method === 'GET' && route === '/api/tabs') {
    return { tabs: store.list() }
  }
  if (method === 'POST' && route === '/api/tabs') {
    return { tab: await createTab(await readJson(req)) }
  }
  const tabId = route.match(/^\/api\/tabs\/([\w-]+)$/)?.[1]
  if (tabId && method === 'PATCH') {
    return { tab: await updateTab(tabId, await readJson(req)) }
  }
  if (tabId && method === 'DELETE') {
    // タブを閉じるだけで、Claude のセッション履歴は残す（履歴から開き直せる）
    sessions.close(tabId)
    terminals.kill(tabId)
    store.remove(tabId)
    return { ok: true }
  }
  throw new HttpError(404, 'Not Found')
}

async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    res.writeHead(400).end()
    return
  }
  const file = path.resolve(DIST_DIR, `.${decoded}`)
  const inDist = file.startsWith(DIST_DIR + path.sep)
  const stat = inDist ? await fs.stat(file).catch(() => null) : null
  // SPA なので存在しないパスは index.html を返す
  const target = stat?.isFile() ? file : path.join(DIST_DIR, 'index.html')
  try {
    const body = await fs.readFile(target)
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(target)] ?? 'application/octet-stream',
    })
    res.end(body)
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(
      'フロントエンドが未ビルドです。`yarn start`（または開発時は `yarn dev`）で起動してください。'
    )
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!isLocalRequest(req)) {
    res.writeHead(403).end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/')) {
    await serveStatic(res, url.pathname)
    return
  }
  try {
    const result = await handleApi(req, url)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(result))
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    if (status === 500) console.error(error)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: errorMessage(error) }))
  }
}

// 想定外の例外でプロセスごと落ちる（実行中の全セッションが止まる）のを防ぐ
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error)
    if (!res.headersSent) res.writeHead(400)
    res.end()
  })
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws' || !isLocalRequest(req)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  } catch {
    socket.destroy()
  }
})

function parseClientMessage(data: unknown): ClientMessage | null {
  try {
    const message: unknown = JSON.parse(String(data))
    if (!message || typeof message !== 'object') return null
    return typeof (message as { type?: unknown }).type === 'string'
      ? (message as ClientMessage)
      : null
  } catch {
    return null
  }
}

async function handleClientMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
  if (message.type === 'term_close') {
    terminals.close(message.tabId, ws)
    return
  }
  if (
    message.type === 'term_open' ||
    message.type === 'term_input' ||
    message.type === 'term_resize'
  ) {
    const tab = store.get(message.tabId)
    if (!tab) throw new HttpError(404, `タブが見つかりません: ${message.tabId}`)
    if (message.type === 'term_open') {
      let data: string
      try {
        data = terminals.open(tab.id, repoPath(tab.repo), message.cols, message.rows, ws)
      } catch (error) {
        // 起動に失敗したことを伝え、画面に再起動ボタンを出させる
        sendTo(ws, { type: 'term_exit', tabId: tab.id, exitCode: -1 })
        throw error
      }
      sendTo(ws, { type: 'term_snapshot', tabId: tab.id, data })
    } else if (message.type === 'term_input') {
      terminals.write(tab.id, message.data)
    } else {
      terminals.resize(tab.id, message.cols, message.rows)
    }
    return
  }
  if (message.type === 'refresh_usage') {
    await usage.refresh()
    return
  }
  const session = sessions.get(message.tabId)
  switch (message.type) {
    case 'subscribe':
      sendTo(ws, { type: 'snapshot', tabId: message.tabId, state: await session.snapshot() })
      return
    case 'send':
      if (message.text.trim()) await session.send(message.text)
      return
    case 'interrupt':
      await session.interrupt()
      return
    case 'permission_response':
      session.respondPermission(message.requestId, message.decision)
      return
  }
}

wss.on('connection', (ws: WebSocket) => {
  addClient(ws)
  sendTo(ws, { type: 'tabs', tabs: store.list() })
  if (usage.usage) sendTo(ws, { type: 'usage', usage: usage.usage })
  usage.refreshIfStale()
  ws.on('close', () => terminals.detach(ws))
  ws.on('message', (data) => {
    const message = parseClientMessage(data)
    if (!message) return
    handleClientMessage(ws, message).catch((error) => {
      const tabId = 'tabId' in message ? message.tabId : null
      sendTo(ws, { type: 'error', tabId, message: errorMessage(error) })
    })
  })
})

// ターミナル（server/main.ts）とデスクトップアプリ（electron/main.ts）の両方から呼ぶ
export async function startServer(): Promise<{ url: string; close: () => void }> {
  await store.load()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  usage.start()
  return {
    url: `http://127.0.0.1:${PORT}`,
    close: () => {
      usage.stop()
      sessions.closeAll()
      terminals.killAll()
      server.close()
    },
  }
}

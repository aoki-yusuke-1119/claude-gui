import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react'

import type {
  PastSession,
  PermissionDecision,
  PermissionModeOption,
  RepoInfo,
} from '../shared/protocol'
import { api } from './api'
import { ChatPane } from './components/ChatPane'
import { FileTree } from './components/FileTree'
import { HistoryMenu } from './components/HistoryMenu'
import { RefreshIcon } from './components/icons'
import { TabBar } from './components/TabBar'
import { UsagePanel } from './components/UsagePanel'
import { copyText } from './clipboard'
import { Socket } from './socket'
import { initialState, reducer } from './state'
import { storage } from './storage'

const MIN_LEFT_WIDTH = 180
const MAX_LEFT_WIDTH = 720

function loadDrafts(): Record<string, string> {
  try {
    return JSON.parse(storage.get('drafts') ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [rootDir, setRootDir] = useState('')
  const [activeTabId, setActiveTabId] = useState<string | null>(() => storage.get('activeTabId'))
  const [drafts, setDrafts] = useState<Record<string, string>>(loadDrafts)
  const [treeRefresh, setTreeRefresh] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [leftWidth, setLeftWidth] = useState(() => Number(storage.get('leftWidth')) || 300)
  const socketRef = useRef<Socket | null>(null)
  const subscribed = useRef(new Set<string>())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const prevBusy = useRef<Record<string, boolean>>({})

  const activeTab = state.tabs.find((t) => t.id === activeTabId) ?? state.tabs[0] ?? null
  const activeLive = activeTab ? state.live[activeTab.id] : undefined
  const repoDir = activeTab
    ? activeTab.repo === '.'
      ? rootDir
      : `${rootDir}/${activeTab.repo}`
    : ''

  const showError = useCallback((error: unknown) => {
    setToast(error instanceof Error ? error.message : String(error))
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    api.repos().then((r) => {
      setRepos(r.repos)
      setRootDir(r.root)
    }, showError)
  }, [showError])

  useEffect(() => {
    // ストリーミングの差分は1フレーム分まとめて反映し、再描画と Markdown の再解析の回数を抑える
    let pendingDeltas = new Map<string, string>()
    let frame = 0
    const flush = () => {
      cancelAnimationFrame(frame)
      frame = 0
      for (const [tabId, delta] of pendingDeltas) dispatch({ type: 'stream', tabId, delta })
      pendingDeltas = new Map()
    }
    const socket = new Socket(
      (message) => {
        if (message.type === 'stream') {
          pendingDeltas.set(message.tabId, (pendingDeltas.get(message.tabId) ?? '') + message.delta)
          frame ||= requestAnimationFrame(flush)
          return
        }
        // 順序を保つため、ほかのメッセージより先に溜まっている差分を反映する
        if (pendingDeltas.size > 0) flush()
        if (message.type === 'error') showError(message.message)
        dispatch(message)
      },
      (connected) => {
        if (!connected) subscribed.current.clear()
        dispatch({ type: 'connection', connected })
      }
    )
    socket.connect()
    socketRef.current = socket
    return () => {
      cancelAnimationFrame(frame)
      socket.dispose()
    }
  }, [showError])

  // まだ状態を受け取っていないタブのスナップショット（履歴＋実行中の状態）を取り寄せる
  useEffect(() => {
    if (!state.connected) return
    for (const tab of state.tabs) {
      if (subscribed.current.has(tab.id)) continue
      if (socketRef.current?.send({ type: 'subscribe', tabId: tab.id })) {
        subscribed.current.add(tab.id)
      }
    }
  }, [state.tabs, state.connected])

  // 同じリポジトリのタブの応答が終わったら、ファイルが変わっている可能性があるのでツリーを再読込する
  useEffect(() => {
    let finished = false
    for (const [id, live] of Object.entries(state.live)) {
      const tab = state.tabs.find((t) => t.id === id)
      if (prevBusy.current[id] && !live.busy && tab?.repo === activeTab?.repo) finished = true
      prevBusy.current[id] = live.busy
    }
    if (finished) setTreeRefresh((n) => n + 1)
  }, [state.live, state.tabs, activeTab?.repo])

  useEffect(() => {
    if (activeTab) storage.set('activeTabId', activeTab.id)
  }, [activeTab])

  useEffect(() => {
    storage.set('drafts', JSON.stringify(drafts))
  }, [drafts])

  const setDraft = (tabId: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [tabId]: value }))

  const newTab = () => {
    const repo = activeTab?.repo ?? repos.find((r) => r.id !== '.')?.id ?? '.'
    api
      .createTab({ repo, permissionMode: activeTab?.permissionMode })
      .then((tab) => setActiveTabId(tab.id), showError)
  }

  const closeTab = (id: string) => {
    if (state.live[id]?.busy && !window.confirm('応答中です。中断してタブを閉じますか？')) return
    const index = state.tabs.findIndex((t) => t.id === id)
    const neighbor = state.tabs[index + 1] ?? state.tabs[index - 1] ?? null
    api.closeTab(id).then(() => {
      if (id === activeTab?.id) setActiveTabId(neighbor?.id ?? null)
      setDrafts(({ [id]: _, ...rest }) => rest)
    }, showError)
  }

  const openPastSession = (session: PastSession) => {
    if (session.openTabId) {
      setActiveTabId(session.openTabId)
      return
    }
    if (!activeTab) return
    api
      .createTab({
        repo: activeTab.repo,
        sessionId: session.sessionId,
        permissionMode: activeTab.permissionMode,
      })
      .then((tab) => setActiveTabId(tab.id), showError)
  }

  const send = () => {
    if (!activeTab) return
    const text = (drafts[activeTab.id] ?? '').trim()
    if (!text) return
    if (!socketRef.current?.send({ type: 'send', tabId: activeTab.id, text })) {
      showError('サーバーに接続していません')
      return
    }
    setDraft(activeTab.id, '')
  }

  const interrupt = useCallback(() => {
    if (!activeTab || !activeLive?.busy) return
    socketRef.current?.send({ type: 'interrupt', tabId: activeTab.id })
  }, [activeTab, activeLive?.busy])

  // Esc で応答を中断する。IME 変換中・1行入力欄・セレクトでの Esc は対象外
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT') return
      if (!activeLive?.busy) return
      e.preventDefault()
      interrupt()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeLive?.busy, interrupt])

  const respond = (requestId: string, decision: PermissionDecision) => {
    if (!activeTab) return
    socketRef.current?.send({
      type: 'permission_response',
      tabId: activeTab.id,
      requestId,
      decision,
    })
  }

  const updateActiveTab = (patch: Parameters<typeof api.updateTab>[1]) => {
    if (activeTab) api.updateTab(activeTab.id, patch).catch(showError)
  }

  const insertPath = (path: string) => {
    if (!activeTab) return
    const el = textareaRef.current
    const current = drafts[activeTab.id] ?? ''
    const start = el?.selectionStart ?? current.length
    const end = el?.selectionEnd ?? start
    const before = current.slice(0, start)
    const mention = `${before && !/\s$/.test(before) ? ' ' : ''}@${/\s/.test(path) ? `"${path}"` : path} `
    setDraft(activeTab.id, before + mention + current.slice(end))
    requestAnimationFrame(() => {
      const pos = (before + mention).length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const copy = (text: string) => {
    copyText(text).then(() => setToast('コピーしました'), showError)
  }

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) =>
      setLeftWidth(Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, ev.clientX)))
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      storage.set(
        'leftWidth',
        String(Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, ev.clientX)))
      )
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  const repoLocked = Boolean(activeTab?.sessionId || activeLive?.items.length)
  const repoName = repos.find((r) => r.id === activeTab?.repo)?.name ?? activeTab?.repo ?? ''

  return (
    <div className="app" style={{ gridTemplateColumns: `${leftWidth}px 5px minmax(0, 1fr)` }}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <select
            className="repo-select"
            value={activeTab?.repo ?? ''}
            disabled={!activeTab || repoLocked}
            title={
              repoLocked
                ? 'セッション開始後はリポジトリを変更できません（新しいタブで開いてください）'
                : 'このセッションで作業するリポジトリ'
            }
            onChange={(e) => updateActiveTab({ repo: e.target.value })}
          >
            {!activeTab && <option value="">リポジトリ</option>}
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            title="ファイルツリーを再読込"
            disabled={!activeTab}
            onClick={() => setTreeRefresh((n) => n + 1)}
          >
            <RefreshIcon />
          </button>
        </div>
        {activeTab ? (
          <FileTree
            key={activeTab.repo}
            repo={activeTab.repo}
            refreshKey={treeRefresh}
            onSelectFile={insertPath}
          />
        ) : (
          <div className="tree-message">セッションを開くとファイルが表示されます</div>
        )}
        <UsagePanel
          usage={state.usage}
          connected={state.connected}
          onRefresh={() => socketRef.current?.send({ type: 'refresh_usage' })}
        />
      </aside>
      <div className="splitter" onPointerDown={startResize} />
      <main className="main">
        {!state.connected && <div className="banner">サーバーに接続しています…</div>}
        <TabBar
          tabs={state.tabs}
          live={state.live}
          activeTabId={activeTab?.id ?? null}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onRename={(id, title) => api.updateTab(id, { title }).catch(showError)}
          onNew={newTab}
        >
          <HistoryMenu
            repo={activeTab?.repo ?? null}
            repoName={repoName}
            onOpen={openPastSession}
          />
        </TabBar>
        {activeTab ? (
          <ChatPane
            tab={activeTab}
            live={activeLive}
            repoDir={repoDir}
            connected={state.connected}
            draft={drafts[activeTab.id] ?? ''}
            textareaRef={textareaRef}
            onDraftChange={(value) => setDraft(activeTab.id, value)}
            onSend={send}
            onInterrupt={interrupt}
            onRespond={respond}
            onRename={(title) => updateActiveTab({ title })}
            onModeChange={(permissionMode: PermissionModeOption) =>
              updateActiveTab({ permissionMode })
            }
            onCopy={copy}
          />
        ) : (
          <div className="empty-state">
            <p>開いているセッションはありません</p>
            <button className="primary" onClick={newTab} disabled={repos.length === 0}>
              新しいセッションを開始
            </button>
          </div>
        )}
      </main>
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}

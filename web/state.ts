import type { ServerMessage, TabInfo, TabLiveState, UsageInfo } from '../shared/protocol'

export interface AppState {
  tabs: TabInfo[]
  // サーバーからスナップショットを受け取ったタブだけが入る
  live: Record<string, TabLiveState>
  connected: boolean
  usage: UsageInfo | null
}

export type Action = ServerMessage | { type: 'connection'; connected: boolean }

export const initialState: AppState = { tabs: [], live: {}, connected: false, usage: null }

function updateLive(
  state: AppState,
  tabId: string,
  update: (live: TabLiveState) => TabLiveState
): AppState {
  const live = state.live[tabId]
  if (!live) return state
  return { ...state, live: { ...state.live, [tabId]: update(live) } }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'connection':
      // 再接続時はスナップショットを取り直すので、古い状態は捨てる
      return action.connected
        ? { ...state, connected: true }
        : { ...state, connected: false, live: {} }
    case 'tabs': {
      const ids = new Set(action.tabs.map((t) => t.id))
      const live = Object.fromEntries(Object.entries(state.live).filter(([id]) => ids.has(id)))
      return { ...state, tabs: action.tabs, live }
    }
    case 'usage':
      return { ...state, usage: action.usage }
    case 'snapshot':
      return { ...state, live: { ...state.live, [action.tabId]: action.state } }
    case 'items':
      return updateLive(state, action.tabId, (l) => ({
        ...l,
        items: [...l.items, ...action.items],
      }))
    case 'stream':
      return updateLive(state, action.tabId, (l) => ({
        ...l,
        streaming: l.streaming + action.delta,
      }))
    case 'stream_reset':
      return updateLive(state, action.tabId, (l) => ({ ...l, streaming: '' }))
    case 'busy':
      return updateLive(state, action.tabId, (l) => ({ ...l, busy: action.busy }))
    case 'permission':
      return updateLive(state, action.tabId, (l) =>
        l.pending.some((p) => p.requestId === action.request.requestId)
          ? l
          : { ...l, pending: [...l.pending, action.request] }
      )
    case 'permission_resolved':
      return updateLive(state, action.tabId, (l) => ({
        ...l,
        pending: l.pending.filter((p) => p.requestId !== action.requestId),
      }))
    case 'error':
    // ターミナルの出力は terminalBus で直接ターミナルに渡す
    case 'term_snapshot':
    case 'term_output':
    case 'term_exit':
      return state
  }
}

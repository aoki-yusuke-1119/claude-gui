// サーバー（server/）とブラウザ（web/）で共有する型

export type PermissionModeOption = 'default' | 'acceptEdits' | 'auto' | 'plan'

export interface RepoInfo {
  id: string
  name: string
}

export interface TabInfo {
  id: string
  repo: string
  sessionId: string | null
  title: string | null
  // ユーザーが手動で付けた名前なら true（自動命名で上書きしない）
  titleByUser: boolean
  permissionMode: PermissionModeOption
  createdAt: number
}

export interface TreeEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  ignored: boolean
}

export interface PastSession {
  sessionId: string
  title: string
  lastModified: number
  openTabId: string | null
}

export type DisplayItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; parentToolUseId: string | null }
  | { kind: 'thinking'; id: string; text: string; parentToolUseId: string | null }
  | {
      kind: 'tool_use'
      id: string
      toolUseId: string
      name: string
      input: Record<string, unknown>
      parentToolUseId: string | null
    }
  | { kind: 'tool_result'; id: string; toolUseId: string; content: string; isError: boolean }
  | {
      kind: 'result'
      id: string
      status: 'success' | 'error' | 'interrupted'
      durationMs: number
      text: string | null
    }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string }

export interface PermissionRequest {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  title: string | null
  description: string | null
  canAlwaysAllow: boolean
}

export type PermissionDecision =
  | { behavior: 'allow'; always?: boolean; answers?: Record<string, string> }
  | { behavior: 'deny'; message?: string }

export interface UsageWindow {
  // 0〜100 の使用率
  utilization: number | null
  // ISO 8601
  resetsAt: string | null
}

// プランのレート制限（CLI の /usage と同じもの）
export interface UsageInfo {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  fetchedAt: number | null
  error: string | null
}

export interface TabLiveState {
  items: DisplayItem[]
  busy: boolean
  streaming: string
  pending: PermissionRequest[]
}

export type ClientMessage =
  | { type: 'subscribe'; tabId: string }
  | { type: 'send'; tabId: string; text: string }
  | { type: 'interrupt'; tabId: string }
  | {
      type: 'permission_response'
      tabId: string
      requestId: string
      decision: PermissionDecision
    }
  | { type: 'refresh_usage' }
  // タブごとのターミナル。open はシェルがなければ起動し、直近の出力を term_snapshot で返す
  | { type: 'term_open'; tabId: string; cols: number; rows: number }
  | { type: 'term_input'; tabId: string; data: string }
  | { type: 'term_resize'; tabId: string; cols: number; rows: number }
  // パネルを閉じた・タブを切り替えた。シェルは動かしたまま出力の送信だけ止める
  | { type: 'term_close'; tabId: string }

export type ServerMessage =
  | { type: 'tabs'; tabs: TabInfo[] }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'snapshot'; tabId: string; state: TabLiveState }
  | { type: 'items'; tabId: string; items: DisplayItem[] }
  | { type: 'stream'; tabId: string; delta: string }
  | { type: 'stream_reset'; tabId: string }
  | { type: 'busy'; tabId: string; busy: boolean }
  | { type: 'permission'; tabId: string; request: PermissionRequest }
  | { type: 'permission_resolved'; tabId: string; requestId: string }
  | { type: 'error'; tabId: string | null; message: string }
  | { type: 'term_snapshot'; tabId: string; data: string }
  | { type: 'term_output'; tabId: string; data: string }
  | { type: 'term_exit'; tabId: string; exitCode: number }

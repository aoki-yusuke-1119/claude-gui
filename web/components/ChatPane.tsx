import { type PointerEvent, type RefObject, useLayoutEffect, useRef } from 'react'

import type {
  ClientMessage,
  PermissionDecision,
  PermissionModeOption,
  TabInfo,
  TabLiveState,
} from '../../shared/protocol'
import { Composer } from './Composer'
import { EditableTitle } from './EditableTitle'
import { CloseIcon, CopyIcon } from './icons'
import { MessageList } from './MessageList'
import { PermissionCard } from './PermissionCard'
import { displayTitle } from './TabBar'
import { startDrag } from '../drag'
import { TerminalPanel } from './TerminalPanel'

const MIN_TERMINAL_HEIGHT = 120
// チャット欄と入力欄の分は残す
const RESERVED_CHAT_HEIGHT = 280

const PERMISSION_MODE_LABELS: Record<PermissionModeOption, string> = {
  default: '都度確認（default）',
  acceptEdits: '編集は自動許可（acceptEdits）',
  auto: '自動判定（auto）',
  plan: 'プランモード（plan）',
}

interface Props {
  tab: TabInfo
  live: TabLiveState | undefined
  repoDir: string
  connected: boolean
  draft: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onDraftChange: (value: string) => void
  onSend: () => void
  onInterrupt: () => void
  onRespond: (requestId: string, decision: PermissionDecision) => void
  onRename: (title: string) => void
  onModeChange: (mode: PermissionModeOption) => void
  onCopy: (text: string, message?: string) => void
  terminalOpen: boolean
  terminalHeight: number
  terminalFocusSignal: number
  onToggleTerminal: () => void
  onTerminalHeightChange: (height: number) => void
  send: (message: ClientMessage) => boolean
}

export function ChatPane(props: Props) {
  const { tab, live, repoDir } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  // 最下部付近を見ているときだけ新着に追従する
  const stickToBottom = useRef(true)

  useLayoutEffect(() => {
    stickToBottom.current = true
  }, [tab.id])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [tab.id, live?.items, live?.streaming, live?.pending, live?.busy])

  return (
    <div className="chat">
      <div className="chat-header">
        <EditableTitle
          className="chat-title"
          value={displayTitle(tab)}
          onSave={props.onRename}
          editOnClick
        />
        <label className="field">
          権限
          <select
            value={tab.permissionMode}
            onChange={(e) => props.onModeChange(e.target.value as PermissionModeOption)}
          >
            {Object.entries(PERMISSION_MODE_LABELS).map(([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {tab.sessionId && (
          <button
            className="header-button"
            title="この会話をターミナル版の Claude Code で続けるコマンドをコピーします。GUI と同時に同じ会話を進めないでください"
            onClick={() =>
              props.onCopy(
                `cd '${repoDir}' && claude --resume ${tab.sessionId ?? ''}`,
                '再開コマンドをコピーしました。ターミナルに貼り付けて実行すると、この会話の続きから使えます'
              )
            }
          >
            <CopyIcon />
            CLI で再開
          </button>
        )}
      </div>
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {live ? (
          <>
            <MessageList live={live} repoDir={repoDir} />
            {live.pending.map((request) => (
              <PermissionCard
                key={request.requestId}
                request={request}
                repoDir={repoDir}
                onRespond={(decision) => props.onRespond(request.requestId, decision)}
              />
            ))}
          </>
        ) : (
          <div className="empty-chat">読み込み中…</div>
        )}
      </div>
      <Composer
        repo={tab.repo}
        value={props.draft}
        busy={live?.busy ?? false}
        connected={props.connected && live !== undefined}
        textareaRef={props.textareaRef}
        onChange={props.onDraftChange}
        onSend={props.onSend}
        onInterrupt={props.onInterrupt}
        terminalOpen={props.terminalOpen}
        onToggleTerminal={props.onToggleTerminal}
      />
      {props.terminalOpen && (
        <div className="terminal" style={{ height: props.terminalHeight }}>
          <div
            className="terminal-header"
            title="ドラッグで高さを変更"
            onPointerDown={(e) => startTerminalResize(e, props)}
          >
            <span className="terminal-title">ターミナル</span>
            <span className="terminal-cwd">{repoDir}</span>
            <button
              className="icon-button"
              title="ターミナルを閉じる（⌘J）。シェルは動いたままです"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={props.onToggleTerminal}
            >
              <CloseIcon />
            </button>
          </div>
          <TerminalPanel
            tabId={tab.id}
            repo={tab.repo}
            connected={props.connected}
            focusSignal={props.terminalFocusSignal}
            send={props.send}
          />
        </div>
      )}
    </div>
  )
}

// 見出しを上下にドラッグしてターミナルの高さを変える
function startTerminalResize(e: PointerEvent<HTMLDivElement>, props: Props): void {
  const startY = e.clientY
  const startHeight = props.terminalHeight
  startDrag(e, (ev) => {
    const max = Math.max(MIN_TERMINAL_HEIGHT, window.innerHeight - RESERVED_CHAT_HEIGHT)
    const height = startHeight + (startY - ev.clientY)
    props.onTerminalHeightChange(Math.round(Math.min(max, Math.max(MIN_TERMINAL_HEIGHT, height))))
  })
}

import { type RefObject, useLayoutEffect, useRef } from 'react'

import type {
  PermissionDecision,
  PermissionModeOption,
  TabInfo,
  TabLiveState,
} from '../../shared/protocol'
import { Composer } from './Composer'
import { EditableTitle } from './EditableTitle'
import { CopyIcon } from './icons'
import { MessageList } from './MessageList'
import { PermissionCard } from './PermissionCard'
import { displayTitle } from './TabBar'

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
  onCopy: (text: string) => void
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
            className="icon-button"
            title="ターミナルの Claude Code で再開するコマンドをコピー"
            onClick={() =>
              props.onCopy(`cd '${repoDir}' && claude --resume ${tab.sessionId ?? ''}`)
            }
          >
            <CopyIcon />
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
        value={props.draft}
        busy={live?.busy ?? false}
        connected={props.connected && live !== undefined}
        textareaRef={props.textareaRef}
        onChange={props.onDraftChange}
        onSend={props.onSend}
        onInterrupt={props.onInterrupt}
      />
    </div>
  )
}

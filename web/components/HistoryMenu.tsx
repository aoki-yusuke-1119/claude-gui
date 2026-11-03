import { useEffect, useRef, useState } from 'react'

import type { PastSession } from '../../shared/protocol'
import { api } from '../api'
import { HistoryIcon } from './icons'

const dateFormat = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

interface Props {
  repo: string | null
  repoName: string
  onOpen: (session: PastSession) => void
}

export function HistoryMenu({ repo, repoName, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<PastSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || repo === null) return
    let cancelled = false
    setSessions(null)
    setError(null)
    api.sessions(repo).then(
      (list) => !cancelled && setSessions(list),
      (e: Error) => !cancelled && setError(e.message)
    )
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    // Esc はメニューを閉じるだけにして、応答中断には使わせない
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelled = true
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, repo])

  return (
    <div className="history" ref={ref}>
      <button
        className="icon-button"
        title="過去のセッションを開く"
        disabled={repo === null}
        onClick={() => setOpen(!open)}
      >
        <HistoryIcon />
      </button>
      {open && (
        <div className="history-menu">
          <div className="history-heading">{repoName} の過去のセッション</div>
          {error && <div className="history-empty error">{error}</div>}
          {!error && sessions === null && <div className="history-empty">読み込み中…</div>}
          {sessions?.length === 0 && <div className="history-empty">セッションがありません</div>}
          {sessions?.map((session) => (
            <button
              key={session.sessionId}
              className="history-item"
              onClick={() => {
                setOpen(false)
                onOpen(session)
              }}
            >
              <span className="history-title">{session.title || '（無題）'}</span>
              <span className="history-meta">
                {session.openTabId && <span className="history-badge">開いています</span>}
                {dateFormat.format(session.lastModified)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

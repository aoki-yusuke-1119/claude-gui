import { useEffect, useState } from 'react'

import type { UsageInfo, UsageWindow } from '../../shared/protocol'
import { RefreshIcon } from './icons'

const timeFormat = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' })
const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function formatRemaining(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)}日${hours % 24}時間`
  if (hours > 0) return `${hours}時間${minutes % 60}分`
  return `${minutes}分`
}

function formatReset(resetsAt: string, now: number): string {
  const date = new Date(resetsAt)
  const remaining = date.getTime() - now
  if (remaining <= 0) return 'まもなくリセット'
  const sameDay = date.toDateString() === new Date(now).toDateString()
  const when = sameDay ? timeFormat.format(date) : dateTimeFormat.format(date)
  return `${when} にリセット（あと${formatRemaining(remaining)}）`
}

function UsageRow({
  label,
  window,
  now,
}: {
  label: string
  window: UsageWindow | null
  now: number
}) {
  const pct = window?.utilization ?? null
  const level = pct === null ? '' : pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : ''
  return (
    <div className="usage-row">
      <div className="usage-line">
        <span>{label}</span>
        <span className={`usage-pct ${level}`}>{pct === null ? '—' : `${Math.round(pct)}%`}</span>
      </div>
      <div className="usage-bar">
        <div className={`usage-fill ${level}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </div>
      {window?.resetsAt && <div className="usage-note">{formatReset(window.resetsAt, now)}</div>}
    </div>
  )
}

interface Props {
  usage: UsageInfo | null
  connected: boolean
  onRefresh: () => void
}

export function UsagePanel({ usage, connected, onRefresh }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const [refreshing, setRefreshing] = useState(false)

  // 「あと◯分」を進めるため定期的に再描画する
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setRefreshing(false)
    setNow(Date.now())
  }, [usage])

  return (
    <div className="usage">
      <div className="usage-header">
        <span className="usage-title">使用量</span>
        {usage?.fetchedAt && (
          <span className="usage-note">{timeFormat.format(usage.fetchedAt)} 時点</span>
        )}
        <button
          className={`icon-button${refreshing ? ' spinning' : ''}`}
          title="使用量を更新"
          disabled={!connected || refreshing}
          onClick={() => {
            setRefreshing(true)
            onRefresh()
          }}
        >
          <RefreshIcon />
        </button>
      </div>
      {usage ? (
        <>
          <UsageRow label="5時間" window={usage.fiveHour} now={now} />
          <UsageRow label="週間" window={usage.sevenDay} now={now} />
          {usage.error && <div className="usage-note error">{usage.error}</div>}
        </>
      ) : (
        <div className="usage-note">取得中…</div>
      )}
    </div>
  )
}

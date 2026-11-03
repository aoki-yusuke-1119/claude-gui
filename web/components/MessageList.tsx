import { memo, type ReactNode, useMemo } from 'react'

import type { DisplayItem, TabLiveState } from '../../shared/protocol'
import { Markdown } from './Markdown'
import { ToolCard } from './ToolCard'

type ToolResultItem = Extract<DisplayItem, { kind: 'tool_result' }>

function parentOf(item: DisplayItem): string | null {
  return item.kind === 'tool_use' || item.kind === 'assistant' || item.kind === 'thinking'
    ? item.parentToolUseId
    : null
}

// ツール結果は対応するツール呼び出しのカードに、サブエージェントの発言は親の Agent カードにまとめる
function groupItems(items: DisplayItem[]) {
  const results = new Map<string, ToolResultItem>()
  const children = new Map<string, DisplayItem[]>()
  const toolUseIds = new Set<string>()
  for (const item of items) {
    if (item.kind === 'tool_result') results.set(item.toolUseId, item)
    if (item.kind === 'tool_use') toolUseIds.add(item.toolUseId)
    const parent = parentOf(item)
    if (parent) children.set(parent, [...(children.get(parent) ?? []), item])
  }
  const topLevel = items.filter(
    (item) =>
      parentOf(item) === null && !(item.kind === 'tool_result' && toolUseIds.has(item.toolUseId))
  )
  return { results, children, topLevel }
}

const RESULT_LABELS = { success: '完了', error: 'エラー', interrupted: '中断' } as const

function formatResult(item: Extract<DisplayItem, { kind: 'result' }>): string {
  return `${RESULT_LABELS[item.status]} · ${(item.durationMs / 1000).toFixed(1)}秒`
}

interface ItemListProps {
  items: DisplayItem[]
  busy: boolean
  repoDir: string
}

// ストリーミングの差分では items が変わらないので、ここは描き直さない
const ItemList = memo(function ItemList({ items, busy, repoDir }: ItemListProps) {
  const { results, children, topLevel } = useMemo(() => groupItems(items), [items])

  const render = (item: DisplayItem): ReactNode => {
    switch (item.kind) {
      case 'user':
        return (
          <div key={item.id} className="msg user">
            <div className="bubble">{item.text}</div>
          </div>
        )
      case 'assistant':
        return (
          <div key={item.id} className="msg assistant">
            <Markdown text={item.text} />
          </div>
        )
      case 'thinking':
        return (
          <details key={item.id} className="thinking">
            <summary>思考</summary>
            <div className="thinking-text">{item.text}</div>
          </details>
        )
      case 'tool_use': {
        const nested = children.get(item.toolUseId)
        return (
          <ToolCard
            key={item.id}
            item={item}
            result={results.get(item.toolUseId)}
            running={busy}
            repoDir={repoDir}
          >
            {nested && nested.map(render)}
          </ToolCard>
        )
      }
      case 'tool_result':
        return (
          <pre key={item.id} className={`code result${item.isError ? ' error' : ''}`}>
            {item.content}
          </pre>
        )
      case 'result':
        return (
          <div key={item.id} className={`turn-result ${item.status}`}>
            {formatResult(item)}
            {item.text && <div className="turn-result-text">{item.text}</div>}
          </div>
        )
      case 'notice':
        return (
          <div key={item.id} className={`notice ${item.level}`}>
            {item.text}
          </div>
        )
    }
  }

  if (topLevel.length === 0 && !busy) {
    return (
      <div className="empty-chat">
        メッセージを入力して <kbd>⌘</kbd>+<kbd>Enter</kbd> で送信します
      </div>
    )
  }
  return <>{topLevel.map(render)}</>
})

interface Props {
  live: TabLiveState
  repoDir: string
}

// 他のタブの更新で App が再描画されても、このタブの状態が同じなら描き直さない
export const MessageList = memo(function MessageList({ live, repoDir }: Props) {
  return (
    <div className="messages">
      <ItemList items={live.items} busy={live.busy} repoDir={repoDir} />
      {live.streaming && (
        <div className="msg assistant streaming">
          <Markdown text={live.streaming} />
        </div>
      )}
      {live.busy && !live.streaming && live.pending.length === 0 && (
        <div className="working">
          <span className="spinner" />
          応答中… <kbd>Esc</kbd> で中断
        </div>
      )}
    </div>
  )
})

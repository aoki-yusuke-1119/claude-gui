import { useRef, useState } from 'react'

interface Props {
  value: string
  onSave: (value: string) => void
  className?: string
  // true ならクリック、false ならダブルクリックで編集を始める
  editOnClick?: boolean
}

export function EditableTitle({ value, onSave, className, editOnClick = false }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const cancelled = useRef(false)

  const start = () => {
    cancelled.current = false
    setDraft(value)
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (!cancelled.current && next && next !== value) onSave(next)
  }

  if (editing) {
    return (
      <input
        className="title-input"
        value={draft}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancelled.current = true
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <span
      className={className}
      title={`${value}（${editOnClick ? 'クリック' : 'ダブルクリック'}で名前を変更）`}
      onClick={editOnClick ? start : undefined}
      onDoubleClick={editOnClick ? undefined : start}
    >
      {value}
    </span>
  )
}

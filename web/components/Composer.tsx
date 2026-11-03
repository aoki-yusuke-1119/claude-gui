import { type RefObject, useLayoutEffect } from 'react'

interface Props {
  value: string
  busy: boolean
  connected: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void
  onSend: () => void
  onInterrupt: () => void
}

// Slack と同じく Enter は改行、⌘+Enter（Windows/Linux では Ctrl+Enter）で送信する
export function Composer({
  value,
  busy,
  connected,
  textareaRef,
  onChange,
  onSend,
  onInterrupt,
}: Props) {
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, textareaRef])

  return (
    <div className="composer">
      <textarea
        ref={textareaRef}
        value={value}
        rows={3}
        placeholder={busy ? '応答中でも送信できます（応答後に処理されます）' : 'メッセージを入力'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSend()
          }
        }}
      />
      <div className="composer-footer">
        <span className="hint">
          <kbd>⌘</kbd>+<kbd>Enter</kbd> 送信 · <kbd>Esc</kbd> 中断 · ファイルをクリックで{' '}
          <code>@パス</code> を挿入
        </span>
        {!connected && <span className="hint error">サーバーに接続していません</span>}
        {busy && (
          <button className="danger" onClick={onInterrupt}>
            中断
          </button>
        )}
        <button className="primary" disabled={!value.trim() || !connected} onClick={onSend}>
          送信
        </button>
      </div>
    </div>
  )
}

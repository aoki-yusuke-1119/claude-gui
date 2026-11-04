import { type RefObject, useLayoutEffect, useState } from 'react'

import { useSlashCommandMenu } from './SlashCommandMenu'

interface Props {
  repo: string
  value: string
  busy: boolean
  connected: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void
  onSend: () => void
  onInterrupt: () => void
  terminalOpen: boolean
  onToggleTerminal: () => void
}

// Slack と同じく Enter は改行、⌘+Enter（Windows/Linux では Ctrl+Enter）で送信する
export function Composer({
  repo,
  value,
  busy,
  connected,
  textareaRef,
  onChange,
  onSend,
  onInterrupt,
  terminalOpen,
  onToggleTerminal,
}: Props) {
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, textareaRef])

  const [focused, setFocused] = useState(false)
  const slash = useSlashCommandMenu({ repo, value, focused, onPick: onChange })

  return (
    <div className="composer">
      <div className="composer-input">
        {slash.menu}
        <textarea
          ref={textareaRef}
          value={value}
          rows={3}
          placeholder={busy ? '応答中でも送信できます（応答後に処理されます）' : 'メッセージを入力'}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (slash.handleKeyDown(e)) return
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSend()
            }
          }}
        />
      </div>
      <div className="composer-footer">
        <span className="hint">
          <kbd>⌘</kbd>+<kbd>Enter</kbd> 送信 · <kbd>Esc</kbd> 中断 · 先頭の <kbd>/</kbd> でコマンド
          · ファイルをクリックで <code>@パス</code> を挿入
        </span>
        {!connected && <span className="hint error">サーバーに接続していません</span>}
        <button
          className={`terminal-toggle${terminalOpen ? ' active' : ''}`}
          title="ターミナルを開く／閉じる"
          onClick={onToggleTerminal}
        >
          ターミナル <kbd>⌘J</kbd>
        </button>
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

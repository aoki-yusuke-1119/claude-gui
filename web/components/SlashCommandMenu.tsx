import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import type { SlashCommandInfo } from '../../shared/protocol'
import { api } from '../api'

// 入力欄がコマンド名だけ（空白を含まない `/xxx`）のときにメニューを出す
const COMMAND_TOKEN = /^\/\S*$/
const MAX_MENU_HEIGHT = 320
// 入力欄との間隔（CSS の bottom）と、ウィンドウ上端との余白
const MENU_MARGIN = 6 + 8

// リポジトリごとの一覧。メニューを開くたびに取り直し、届くまでは前回の一覧を表示する
const cache = new Map<string, SlashCommandInfo[]>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function useCommands(repo: string, enabled: boolean) {
  const commands = useSyncExternalStore(subscribe, () => cache.get(repo) ?? null)
  const [error, setError] = useState<{ repo: string; message: string } | null>(null)
  // 前回の失敗は閉じたら消す（開き直したら、取り直している間は「読み込み中」を出す）
  if (!enabled && error) setError(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    api.commands(repo).then(
      (commands) => {
        cache.set(repo, commands)
        for (const listener of listeners) listener()
      },
      (e: unknown) => {
        if (!cancelled) setError({ repo, message: e instanceof Error ? e.message : String(e) })
      }
    )
    return () => {
      cancelled = true
    }
  }, [repo, enabled])

  return { commands, error: error?.repo === repo ? error.message : null }
}

// 名前・別名の前方一致、部分一致、説明の部分一致の順に並べる（同順位は名前順のまま）
function matchCommands(commands: SlashCommandInfo[], query: string): SlashCommandInfo[] {
  const q = query.toLowerCase()
  if (!q) return commands
  const rank = (command: SlashCommandInfo) => {
    const names = [command.name, ...command.aliases].map((name) => name.toLowerCase())
    if (names.some((name) => name.startsWith(q))) return 0
    if (names.some((name) => name.includes(q))) return 1
    if (command.description.toLowerCase().includes(q)) return 2
    return -1
  }
  return commands
    .map((command) => ({ command, rank: rank(command) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.command)
}

// ターミナルを大きく開いているとチャット欄が狭いので、入力欄より上の空きに収める
function fitToSpaceAbove(list: HTMLElement) {
  const anchor = list.parentElement
  if (!anchor) return
  const space = anchor.getBoundingClientRect().top - MENU_MARGIN
  list.style.maxHeight = `${Math.max(0, Math.min(MAX_MENU_HEIGHT, space))}px`
}

interface Options {
  repo: string
  value: string
  focused: boolean
  onPick: (value: string) => void
}

export function useSlashCommandMenu({ repo, value, focused, onPick }: Options) {
  // Esc で閉じたときの入力。入力が変わったら開き直す
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (dismissed !== null && dismissed !== value) setDismissed(null)
  const [selection, setSelection] = useState({ query: '', index: 0 })
  const listRef = useRef<HTMLDivElement>(null)

  const open = focused && COMMAND_TOKEN.test(value) && value !== dismissed
  const { commands, error } = useCommands(repo, open)
  const query = value.slice(1)
  const items = open && commands ? matchCommands(commands, query) : []
  const index = selection.query === query ? Math.min(selection.index, items.length - 1) : 0
  // 一致するものがあれば一覧を、一覧がまだ届いていなければ取得の状況を出す（一致なしなら何も出さない）
  const visible = items.length > 0 || (open && !commands)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    fitToSpaceAbove(list)
    // scrollIntoView は外側のレイアウトまでスクロールさせることがあるので、メニュー内だけ動かす
    const item = list.querySelector<HTMLElement>('.selected')
    if (!item) return
    if (item.offsetTop < list.scrollTop) {
      list.scrollTop = item.offsetTop
    } else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight
    }
  }, [index, visible, items.length])

  useEffect(() => {
    if (!visible) return
    const onResize = () => {
      if (listRef.current) fitToSpaceAbove(listRef.current)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [visible])

  const pick = (command: SlashCommandInfo) => onPick(`/${command.name} `)

  // メニューで処理したキーなら true を返す（表示中の Esc は preventDefault で応答の中断に回さない）
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!visible) return false
    if (e.key === 'Escape') {
      e.preventDefault()
      setDismissed(value)
      return true
    }
    // Shift との組み合わせ（範囲選択など）は入力欄に任せる
    if (items.length === 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setSelection({ query, index: (index + step + items.length) % items.length })
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      pick(items[index])
      return true
    }
    return false
  }

  const menu: ReactNode = visible ? (
    <div
      className="slash-menu"
      ref={listRef}
      role="listbox"
      aria-label="スラッシュコマンド"
      // 項目の間の余白やスクロールバーを押しても、入力欄のフォーカスを外さない
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.length > 0 ? (
        items.map((command, i) => (
          <div
            key={command.name}
            role="option"
            aria-selected={i === index}
            className={i === index ? 'slash-item selected' : 'slash-item'}
            title={command.description}
            onMouseDown={() => pick(command)}
            onMouseMove={() => {
              if (i !== index) setSelection({ query, index: i })
            }}
          >
            <div className="slash-item-name">
              <span className="slash-name">/{command.name}</span>
              {command.argumentHint && <span className="slash-hint">{command.argumentHint}</span>}
            </div>
            {command.description && <div className="slash-desc">{command.description}</div>}
          </div>
        ))
      ) : error ? (
        <div className="slash-status error">コマンドの一覧を取得できませんでした: {error}</div>
      ) : (
        <div className="slash-status">読み込み中…</div>
      )}
    </div>
  ) : null

  return { menu, handleKeyDown }
}

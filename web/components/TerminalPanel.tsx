import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { type ITheme, Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ClientMessage } from '../../shared/protocol'
import { onTerminalEvent } from '../terminalBus'

const DARK_THEME: ITheme = {
  background: '#1b1b19',
  foreground: '#ecebe6',
  cursor: '#d77a57',
  selectionBackground: 'rgba(215, 122, 87, 0.35)',
}

// 既定の配色は白背景だと黄色などが読めないので、明るい背景向けに調整する
const LIGHT_THEME: ITheme = {
  background: '#fbfbf9',
  foreground: '#22211f',
  cursor: '#b95d3c',
  selectionBackground: 'rgba(185, 93, 60, 0.25)',
  black: '#22211f',
  red: '#b3261e',
  green: '#2e7d32',
  yellow: '#8a6100',
  blue: '#1f5fbf',
  magenta: '#8e3fa8',
  cyan: '#0f7b8a',
  white: '#a3a19a',
  brightBlack: '#74726c',
  brightRed: '#d0342c',
  brightGreen: '#3a8f3e',
  brightYellow: '#a67500',
  brightBlue: '#2f6fd6',
  brightMagenta: '#a24fbd',
  brightCyan: '#178c9c',
  brightWhite: '#c8c6bf',
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const themeNow = () => (darkQuery.matches ? DARK_THEME : LIGHT_THEME)

interface Props {
  tabId: string
  repo: string
  connected: boolean
  // 値が変わるたびにターミナルにフォーカスする（⌘J で開いたときなど）
  focusSignal: number
  send: (message: ClientMessage) => boolean
}

export function TerminalPanel({ tabId, repo, connected, focusSignal, send }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const sendRef = useRef(send)
  sendRef.current = send
  const [exitCode, setExitCode] = useState<number | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: themeNow(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // 既定の処理は空のウィンドウを開いてから URL を入れるため、デスクトップ版では開けない。URL を直接渡す
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank', 'noopener')))
    // 絵文字や罫線の文字幅を CLI（Claude Code など）と揃える
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.open(host)
    fit.fit()
    termRef.current = term
    setExitCode(null)

    // 過去の出力を描き直している間は、その中の端末への問い合わせ（カーソル位置など）に xterm が
    // 改めて応答してしまうので、その応答をシェルへ送らない
    let replaying = false
    const off = onTerminalEvent(tabId, (event) => {
      if (event.type === 'term_snapshot') {
        term.reset()
        replaying = true
        term.write(event.data, () => (replaying = false))
        setExitCode(null)
      } else if (event.type === 'term_output') {
        term.write(event.data)
      } else {
        setExitCode(event.exitCode)
        term.write(
          event.exitCode === -1
            ? '\r\n\x1b[2m[シェルを起動できませんでした]\x1b[0m\r\n'
            : `\r\n\x1b[2m[シェルが終了しました（終了コード ${event.exitCode}）]\x1b[0m\r\n`
        )
      }
    })
    const input = term.onData((data) => {
      if (!replaying) sendRef.current({ type: 'term_input', tabId, data })
    })
    const resize = term.onResize(({ cols, rows }) =>
      sendRef.current({ type: 'term_resize', tabId, cols, rows })
    )
    // パネルの高さやウィンドウの幅が変わったら桁数・行数を合わせる
    const observer = new ResizeObserver(() => {
      if (host.clientHeight > 0 && host.clientWidth > 0) fit.fit()
    })
    observer.observe(host)
    const onSchemeChange = () => (term.options.theme = themeNow())
    darkQuery.addEventListener('change', onSchemeChange)

    return () => {
      // シェルは動かしたまま、この画面への出力の送信だけ止めてもらう
      sendRef.current({ type: 'term_close', tabId })
      darkQuery.removeEventListener('change', onSchemeChange)
      observer.disconnect()
      off()
      input.dispose()
      resize.dispose()
      term.dispose()
      termRef.current = null
    }
  }, [tabId, repo])

  // シェルがなければサーバー側で起動し、これまでの出力を受け取る
  const open = useCallback(() => {
    const term = termRef.current
    if (term) sendRef.current({ type: 'term_open', tabId, cols: term.cols, rows: term.rows })
  }, [tabId])

  // 表示したとき・再接続したとき・リポジトリが変わったときにシェルへつなぐ
  useEffect(() => {
    if (connected) open()
  }, [connected, open, repo])

  useEffect(() => {
    if (focusSignal > 0) termRef.current?.focus()
  }, [focusSignal])

  return (
    <div className="terminal-body">
      <div className="terminal-host" ref={hostRef} />
      {exitCode !== null && (
        <button className="terminal-restart" onClick={open}>
          シェルを再起動
        </button>
      )}
    </div>
  )
}

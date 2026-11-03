import * as pty from 'node-pty'
import type { WebSocket } from 'ws'

import type { ServerMessage } from '../shared/protocol'
import { APP_DIR } from './config'
import { HttpError } from './errors'
import { sendTo } from './hub'

// タブ切り替えや再接続のときに描き直すため、直近の出力をサーバー側に残しておく
const MAX_BUFFER = 512 * 1024
// 大量出力で WebSocket のメッセージが細かくなりすぎないよう、この間隔でまとめて送る
const FLUSH_INTERVAL_MS = 10
// 起動元（yarn・VS Code のターミナル・Claude Code・このアプリ自身）から引き継いだ変数のうち、
// シェルで実行するコマンドの動作を変えてしまうもの。必要なものはログインシェルが設定し直す
const DROPPED_ENV =
  /^(CLAUDE_GUI_|npm_|VSCODE_|ELECTRON_)|^(PORT|INIT_CWD|TERM_PROGRAM|TERM_PROGRAM_VERSION|CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_SSE_PORT)$/

interface Term {
  pty: pty.IPty
  // 出力はチャンクのまま持ち、古いものからチャンク単位で捨てる（途中で切ってエスケープシーケンスを壊さない）
  chunks: string[]
  length: number
  truncated: boolean
  pending: string
  flushTimer: NodeJS.Timeout | null
  // パネルを開いている画面。出力はここにだけ送る
  subscribers: Set<WebSocket>
}

function size(value: unknown): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new HttpError(400, '不正な端末サイズです')
  return n
}

function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !DROPPED_ENV.test(key)) env[key] = value
  }
  // yarn 経由で起動したときに先頭へ足される、このアプリの node_modules/.bin や yarn の一時ディレクトリを除く
  if (env.PATH) {
    env.PATH = env.PATH.split(':')
      .filter((dir) => dir && !dir.startsWith(APP_DIR) && !/\/yarn--\d+/.test(dir))
      .join(':')
  }
  // Dock から起動すると LANG が無く、日本語のファイル名などが化けるため
  env.LANG ??= 'ja_JP.UTF-8'
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}

export class TerminalManager {
  private readonly terms = new Map<string, Term>()

  // シェルがなければ起動し、ws を出力の送り先に加えて、これまでの出力を返す
  open(tabId: string, cwd: string, cols: unknown, rows: unknown, ws: WebSocket): string {
    let term = this.terms.get(tabId)
    if (term) term.pty.resize(size(cols), size(rows))
    else term = this.spawn(tabId, cwd, size(cols), size(rows))
    // 未送信の出力は返す内容に含まれているので、先に送り切っておく（二重に表示されないように）
    this.flush(tabId, term)
    term.subscribers.add(ws)
    return (term.truncated ? '\x1b[0m' : '') + term.chunks.join('')
  }

  write(tabId: string, data: unknown): void {
    if (typeof data === 'string') this.terms.get(tabId)?.pty.write(data)
  }

  resize(tabId: string, cols: unknown, rows: unknown): void {
    this.terms.get(tabId)?.pty.resize(size(cols), size(rows))
  }

  close(tabId: string, ws: WebSocket): void {
    this.terms.get(tabId)?.subscribers.delete(ws)
  }

  // 画面との接続が切れたとき
  detach(ws: WebSocket): void {
    for (const term of this.terms.values()) term.subscribers.delete(ws)
  }

  // すぐ一覧から外すので、直後の open では新しいシェルが起動する
  kill(tabId: string): void {
    const term = this.terms.get(tabId)
    if (!term) return
    this.terms.delete(tabId)
    if (term.flushTimer) clearTimeout(term.flushTimer)
    term.pty.kill()
  }

  killAll(): void {
    for (const tabId of [...this.terms.keys()]) this.kill(tabId)
  }

  private spawn(tabId: string, cwd: string, cols: number, rows: number): Term {
    const term: Term = {
      pty: pty.spawn(process.env.SHELL || '/bin/zsh', ['-l'], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: shellEnv(),
      }),
      chunks: [],
      length: 0,
      truncated: false,
      pending: '',
      flushTimer: null,
      subscribers: new Set(),
    }
    term.pty.onData((data) => {
      term.chunks.push(data)
      term.length += data.length
      while (term.length > MAX_BUFFER && term.chunks.length > 1) {
        term.length -= term.chunks.shift()!.length
        term.truncated = true
      }
      term.pending += data
      term.flushTimer ??= setTimeout(() => this.flush(tabId, term), FLUSH_INTERVAL_MS)
    })
    term.pty.onExit(({ exitCode }) => {
      // kill() したシェル（リポジトリ変更・タブを閉じた）の終了は、新しいシェルの画面に伝えない
      if (this.terms.get(tabId) !== term) return
      this.flush(tabId, term)
      this.terms.delete(tabId)
      this.send(term, { type: 'term_exit', tabId, exitCode })
    })
    this.terms.set(tabId, term)
    return term
  }

  private flush(tabId: string, term: Term): void {
    if (term.flushTimer) clearTimeout(term.flushTimer)
    term.flushTimer = null
    if (!term.pending) return
    this.send(term, { type: 'term_output', tabId, data: term.pending })
    term.pending = ''
  }

  private send(term: Term, message: ServerMessage): void {
    for (const ws of term.subscribers) sendTo(ws, message)
  }
}

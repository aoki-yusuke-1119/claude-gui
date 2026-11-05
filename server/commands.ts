import type { Query, SlashCommand } from '@anthropic-ai/claude-agent-sdk'

import type { SlashCommandInfo } from '../shared/protocol'
import { repoPath } from './repos'
import { withTemporaryQuery, withTimeout } from './temporaryQuery'

// スキルやコマンドの追加・変更を拾えるよう、この時間が過ぎたら裏で取り直す
const CACHE_TTL_MS = 60 * 1000
const TIMEOUT_MESSAGE = 'コマンド一覧の取得がタイムアウトしました'

interface Entry {
  commands: SlashCommandInfo[]
  fetchedAt: number
}

function toInfo(commands: SlashCommand[]): SlashCommandInfo[] {
  const byName = new Map<string, SlashCommand>()
  for (const command of commands) {
    // `__` で始まるものは CLI の内部用
    if (command.name.startsWith('__')) continue
    // 同名のものがあれば組み込みのほうが実行される
    if (!byName.has(command.name) || command.builtin) byName.set(command.name, command)
  }
  // 型では必須でも CLI のバージョンによって欠けることがあるので、画面側で扱える形にそろえる
  return [...byName.values()]
    .map((command) => ({
      name: command.name,
      description: command.description ?? '',
      argumentHint: command.argumentHint ?? '',
      aliases: command.aliases ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function fetchCommands(q: Query): Promise<SlashCommand[]> {
  return withTimeout(q.supportedCommands(), TIMEOUT_MESSAGE)
}

// プロジェクトのコマンド・スキル・プラグインも含めるため設定ファイルは読み込むが、
// 一覧を取るだけなので hook の実行と MCP サーバーへの接続は止める
function fetchWithTemporaryQuery(repo: string): Promise<SlashCommand[]> {
  return withTemporaryQuery(
    { cwd: repoPath(repo), strictMcpConfig: true, settings: { disableAllHooks: true } },
    fetchCommands
  )
}

export class CommandCatalog {
  private readonly cache = new Map<string, Entry>()
  private readonly inflight = new Map<string, Promise<SlashCommandInfo[]>>()

  // そのリポジトリで稼働中のセッションの CLI があればそれに問い合わせ、なければ一時的に CLI を起動する
  constructor(private readonly activeQueryIn: (repo: string) => Query | null) {}

  // 期限が切れていても前回の一覧をすぐ返し、裏で取り直す（失敗したら前回の一覧のまま）
  async list(repo: string): Promise<SlashCommandInfo[]> {
    const cached = this.cache.get(repo)
    if (!cached) return this.refresh(repo)
    if (Date.now() - cached.fetchedAt >= CACHE_TTL_MS) {
      this.refresh(repo).catch((error: unknown) => {
        console.error(error)
        // 失敗が続く間、メニューを開くたびに CLI を起動しないよう間隔をあける
        cached.fetchedAt = Date.now()
      })
    }
    return cached.commands
  }

  private refresh(repo: string): Promise<SlashCommandInfo[]> {
    let promise = this.inflight.get(repo)
    if (!promise) {
      promise = this.load(repo).finally(() => this.inflight.delete(repo))
      this.inflight.set(repo, promise)
    }
    return promise
  }

  private async load(repo: string): Promise<SlashCommandInfo[]> {
    const active = this.activeQueryIn(repo)
    const commands = toInfo(
      active ? await fetchCommands(active) : await fetchWithTemporaryQuery(repo)
    )
    this.cache.set(repo, { commands, fetchedAt: Date.now() })
    return commands
  }
}

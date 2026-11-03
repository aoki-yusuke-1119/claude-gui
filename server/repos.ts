import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RepoInfo, TreeEntry } from '../shared/protocol'
import { ROOT_DIR } from './config'
import { HttpError } from './errors'

// ROOT_DIR 自体を対象にするときのリポジトリ ID
export const ROOT_REPO_ID = '.'

const HIDDEN_ENTRIES = new Set(['.git', '.DS_Store'])

export async function listRepos(): Promise<RepoInfo[]> {
  const entries = await fs.readdir(ROOT_DIR, { withFileTypes: true })
  const repos = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => ({ id: e.name, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [{ id: ROOT_REPO_ID, name: `${path.basename(ROOT_DIR)}（全体）` }, ...repos]
}

export function repoPath(repo: string): string {
  if (repo === ROOT_REPO_ID) return ROOT_DIR
  if (!repo || repo.startsWith('.') || repo.includes('/') || repo.includes('\\')) {
    throw new HttpError(400, `不正なリポジトリ名です: ${repo}`)
  }
  return path.join(ROOT_DIR, repo)
}

export async function assertRepo(repo: string): Promise<void> {
  const stat = await fs.stat(repoPath(repo)).catch(() => null)
  if (!stat?.isDirectory()) throw new HttpError(404, `リポジトリが見つかりません: ${repo}`)
}

function resolveInRepo(repo: string, relPath: string): string {
  const base = repoPath(repo)
  const resolved = path.resolve(base, relPath)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new HttpError(400, `リポジトリ外のパスです: ${relPath}`)
  }
  return resolved
}

// 開く・ゴミ箱に移動する対象。リポジトリ自体と .git 配下は操作させない
async function resolveEntry(repo: string, relPath: string): Promise<string> {
  const target = resolveInRepo(repo, relPath)
  if (target === repoPath(repo)) throw new HttpError(400, 'リポジトリ自体は操作できません')
  // macOS のファイルシステムは大文字小文字を区別しないので、.GIT なども同じものとして扱う
  const segments = path.relative(repoPath(repo), target).split(path.sep)
  if (segments.some((segment) => segment.toLowerCase() === '.git')) {
    throw new HttpError(400, '.git 配下は操作できません')
  }
  if (!(await fs.lstat(target).catch(() => null))) {
    throw new HttpError(404, `ファイルが見つかりません: ${relPath}`)
  }
  return target
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, _stdout, stderr) =>
      error ? reject(new HttpError(500, stderr.trim() || error.message)) : resolve()
    )
  })
}

// open で「開く」と実行・インストールされてしまう種類
const LAUNCHABLE_EXTENSIONS = new Set([
  '.app',
  '.command',
  '.tool',
  '.terminal',
  '.sh',
  '.bash',
  '.zsh',
  '.csh',
  '.ksh',
  '.fish',
  '.jar',
  '.workflow',
  '.action',
  '.pkg',
  '.mpkg',
])

// 既定のアプリで開く（フォルダなら Finder）。実行されてしまうものは開かず Finder で場所を表示する
export async function openEntry(repo: string, relPath: string): Promise<{ revealed: boolean }> {
  const target = await resolveEntry(repo, relPath)
  const stat = await fs.stat(target).catch(() => null)
  const launchable =
    !stat ||
    LAUNCHABLE_EXTENSIONS.has(path.extname(target).toLowerCase()) ||
    (stat.isFile() && (stat.mode & 0o111) !== 0)
  if (process.platform !== 'darwin') {
    await run('xdg-open', [launchable ? path.dirname(target) : target])
  } else {
    await run('open', launchable ? ['-R', target] : [target])
  }
  return { revealed: launchable }
}

// 誤操作に備えて完全には削除せず、ゴミ箱に移動する
export async function trashEntry(repo: string, relPath: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new HttpError(501, 'ゴミ箱への移動は macOS のみ対応しています')
  }
  const target = await resolveEntry(repo, relPath)
  // 「全体」タブなどから、リポジトリ（サブモジュールを含む）をフォルダごと消せないようにする
  if (await fs.lstat(path.join(target, '.git')).catch(() => null)) {
    throw new HttpError(400, 'リポジトリのフォルダは削除できません')
  }
  await run('/usr/bin/trash', [target])
}

export async function listTree(repo: string, relPath: string): Promise<TreeEntry[]> {
  const base = repoPath(repo)
  const dir = resolveInRepo(repo, relPath)
  const dirents = (await fs.readdir(dir, { withFileTypes: true })).filter(
    (d) => !HIDDEN_ENTRIES.has(d.name)
  )
  // ディレクトリは末尾に / を付けて渡さないと `node_modules/` のようなパターンに一致しない
  const queryNames = dirents.map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
  const ignored = await gitIgnored(dir, queryNames)
  return dirents
    .map((d, i) => ({
      name: d.name,
      path: path.relative(base, path.join(dir, d.name)),
      type: d.isDirectory() ? ('dir' as const) : ('file' as const),
      ignored: ignored.has(queryNames[i]),
    }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
}

// git 管理外のディレクトリでは空集合になる。
// -z なしだと日本語などのパスが "\346..." のように引用符付きで返り、照合できない
function gitIgnored(cwd: string, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return Promise.resolve(new Set())
  return new Promise((resolve) => {
    const child = execFile('git', ['check-ignore', '-z', '--stdin'], { cwd }, (_error, stdout) => {
      resolve(new Set(stdout.split('\0').filter(Boolean)))
    })
    child.stdin?.end(names.join('\0'))
  })
}

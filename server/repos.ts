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

export async function listTree(repo: string, relPath: string): Promise<TreeEntry[]> {
  const base = repoPath(repo)
  const dir = path.resolve(base, relPath)
  if (dir !== base && !dir.startsWith(base + path.sep)) {
    throw new HttpError(400, `リポジトリ外のパスです: ${relPath}`)
  }
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

import type {
  PastSession,
  PermissionModeOption,
  RepoInfo,
  TabInfo,
  TreeEntry,
} from '../shared/protocol'

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`)
  return data
}

export const api = {
  repos: () => request<{ root: string; repos: RepoInfo[] }>('GET', '/api/repos'),
  tree: (repo: string, path: string) =>
    request<{ entries: TreeEntry[] }>(
      'GET',
      `/api/tree?${new URLSearchParams({ repo, path }).toString()}`
    ).then((r) => r.entries),
  openFile: (repo: string, path: string) =>
    request<{ ok: true; revealed: boolean }>('POST', '/api/files/open', { repo, path }),
  trashFile: (repo: string, path: string) =>
    request<{ ok: true }>('POST', '/api/files/trash', { repo, path }),
  sessions: (repo: string) =>
    request<{ sessions: PastSession[] }>(
      'GET',
      `/api/sessions?${new URLSearchParams({ repo }).toString()}`
    ).then((r) => r.sessions),
  createTab: (body: { repo: string; sessionId?: string; permissionMode?: PermissionModeOption }) =>
    request<{ tab: TabInfo }>('POST', '/api/tabs', body).then((r) => r.tab),
  updateTab: (
    id: string,
    body: Partial<{ repo: string; title: string; permissionMode: PermissionModeOption }>
  ) => request<{ tab: TabInfo }>('PATCH', `/api/tabs/${id}`, body).then((r) => r.tab),
  closeTab: (id: string) => request<{ ok: true }>('DELETE', `/api/tabs/${id}`),
}

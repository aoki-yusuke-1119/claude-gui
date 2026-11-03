import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import type { TreeEntry } from '../../shared/protocol'
import { api } from '../api'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ChevronIcon, FileIcon, FolderIcon } from './icons'

// リポジトリごとの展開状態（タブやリポジトリを切り替えても保持する）
const expandedByRepo = new Map<string, Set<string>>()

const parentDir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

interface Props {
  repo: string
  refreshKey: number
  onInsertPath: (path: string) => void
  onError: (error: unknown) => void
  onNotice: (message: string) => void
}

export function FileTree({ repo, refreshKey, onInsertPath, onError, onNotice }: Props) {
  const [entries, setEntries] = useState<Record<string, TreeEntry[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedByRepo.get(repo) ?? new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; entry: TreeEntry } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const updateExpanded = useCallback(
    (update: (prev: Set<string>) => Set<string>) => {
      setExpanded((prev) => {
        const next = update(prev)
        expandedByRepo.set(repo, next)
        return next
      })
    },
    [repo]
  )

  const load = useCallback(
    async (dir: string) => {
      try {
        const list = await api.tree(repo, dir)
        setEntries((prev) => ({ ...prev, [dir]: list }))
        setErrors(({ [dir]: _, ...rest }) => rest)
      } catch (error) {
        if (dir) {
          // 削除されたディレクトリは展開状態から外す
          updateExpanded((prev) => new Set([...prev].filter((p) => p !== dir)))
        } else {
          setErrors((prev) => ({ ...prev, [dir]: (error as Error).message }))
        }
      }
    },
    [repo, updateExpanded]
  )

  useEffect(() => {
    for (const dir of ['', ...expandedRef.current]) void load(dir)
  }, [load, refreshKey])

  const toggle = (dir: string) => {
    const opening = !expanded.has(dir)
    updateExpanded((prev) => {
      const next = new Set(prev)
      if (opening) next.add(dir)
      else next.delete(dir)
      return next
    })
    if (opening) void load(dir)
  }

  const trash = async (entry: TreeEntry) => {
    const kind = entry.type === 'dir' ? 'フォルダ' : 'ファイル'
    if (!window.confirm(`${kind}「${entry.path}」をゴミ箱に移動しますか？`)) return
    try {
      await api.trashFile(repo, entry.path)
      if (entry.type === 'dir') {
        updateExpanded(
          (prev) =>
            new Set([...prev].filter((p) => p !== entry.path && !p.startsWith(`${entry.path}/`)))
        )
      }
      await load(parentDir(entry.path))
    } catch (error) {
      onError(error)
    }
  }

  const menuItems = (entry: TreeEntry): MenuItem[] => [
    {
      label: entry.type === 'dir' ? 'Finder で開く' : 'ファイルを開く',
      onSelect: () =>
        void api.openFile(repo, entry.path).then((result) => {
          if (result.revealed) {
            onNotice('開くと実行されるファイルのため、開かずに Finder で場所を表示しました')
          }
        }, onError),
    },
    { label: '@パスを挿入', onSelect: () => onInsertPath(entry.path) },
    {
      label: '削除（ゴミ箱に移動）',
      danger: true,
      separatorBefore: true,
      onSelect: () => void trash(entry),
    },
  ]

  const renderDir = (dir: string, depth: number): ReactNode => {
    const indent = { paddingLeft: 8 + depth * 14 }
    const list = entries[dir]
    if (!list) {
      return (
        <div className={errors[dir] ? 'tree-message error' : 'tree-message'} style={indent}>
          {errors[dir] ?? '読み込み中…'}
        </div>
      )
    }
    if (list.length === 0) {
      return (
        <div className="tree-message" style={indent}>
          （空）
        </div>
      )
    }
    return list.map((entry) => {
      const isOpen = entry.type === 'dir' && expanded.has(entry.path)
      return (
        <Fragment key={entry.path}>
          <div
            className={`tree-row${entry.ignored ? ' ignored' : ''}${menu?.entry.path === entry.path ? ' menu-open' : ''}`}
            style={indent}
            title={
              entry.type === 'file'
                ? `${entry.path}（クリックで入力欄に挿入・右クリックでメニュー）`
                : `${entry.path}（右クリックでメニュー）`
            }
            onClick={() => (entry.type === 'dir' ? toggle(entry.path) : onInsertPath(entry.path))}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, entry })
            }}
          >
            <span className={`tree-caret${isOpen ? ' open' : ''}`}>
              {entry.type === 'dir' && <ChevronIcon />}
            </span>
            <span className={`tree-icon ${entry.type}`}>
              {entry.type === 'dir' ? <FolderIcon /> : <FileIcon />}
            </span>
            <span className="tree-name">{entry.name}</span>
          </div>
          {isOpen && renderDir(entry.path, depth + 1)}
        </Fragment>
      )
    })
  }

  return (
    <div className="tree">
      {renderDir('', 0)}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={closeMenu} />
      )}
    </div>
  )
}

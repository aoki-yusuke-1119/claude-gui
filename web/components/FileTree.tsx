import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import type { TreeEntry } from '../../shared/protocol'
import { api } from '../api'
import { ChevronIcon, FileIcon, FolderIcon } from './icons'

// リポジトリごとの展開状態（タブやリポジトリを切り替えても保持する）
const expandedByRepo = new Map<string, Set<string>>()

interface Props {
  repo: string
  refreshKey: number
  onSelectFile: (path: string) => void
}

export function FileTree({ repo, refreshKey, onSelectFile }: Props) {
  const [entries, setEntries] = useState<Record<string, TreeEntry[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedByRepo.get(repo) ?? new Set())
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
            className={`tree-row${entry.ignored ? ' ignored' : ''}`}
            style={indent}
            title={entry.type === 'file' ? `${entry.path}（クリックで入力欄に挿入）` : entry.path}
            onClick={() => (entry.type === 'dir' ? toggle(entry.path) : onSelectFile(entry.path))}
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

  return <div className="tree">{renderDir('', 0)}</div>
}

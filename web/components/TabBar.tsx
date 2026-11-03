import type { ReactNode } from 'react'

import type { TabInfo, TabLiveState } from '../../shared/protocol'
import { EditableTitle } from './EditableTitle'
import { CloseIcon, PlusIcon } from './icons'

export function displayTitle(tab: TabInfo): string {
  return tab.title ?? '新しいセッション'
}

interface Props {
  tabs: TabInfo[]
  live: Record<string, TabLiveState>
  activeTabId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, title: string) => void
  onNew: () => void
  children?: ReactNode
}

export function TabBar({
  tabs,
  live,
  activeTabId,
  onSelect,
  onClose,
  onRename,
  onNew,
  children,
}: Props) {
  return (
    <div className="tabbar">
      <div className="tabs" role="tablist">
        {tabs.map((tab) => {
          const state = live[tab.id]
          const status = state?.pending.length ? 'attention' : state?.busy ? 'busy' : 'idle'
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTabId}
              className={`tab${tab.id === activeTabId ? ' active' : ''}`}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(e) => e.button === 1 && onClose(tab.id)}
            >
              <span
                className={`tab-status ${status}`}
                title={
                  status === 'attention' ? '確認待ち' : status === 'busy' ? '応答中' : undefined
                }
              />
              <EditableTitle
                className="tab-title"
                value={displayTitle(tab)}
                onSave={(title) => onRename(tab.id, title)}
              />
              <button
                className="tab-close"
                title="タブを閉じる（セッション履歴は残ります）"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
              >
                <CloseIcon />
              </button>
            </div>
          )
        })}
      </div>
      <button className="icon-button" title="新しいセッション" onClick={onNew}>
        <PlusIcon />
      </button>
      {children}
    </div>
  )
}

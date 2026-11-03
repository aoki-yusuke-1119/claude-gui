import { type ReactNode, useState } from 'react'

import type { DisplayItem } from '../../shared/protocol'
import { CopyButton } from './CopyButton'
import { ChevronIcon } from './icons'
import { Markdown } from './Markdown'

type ToolUseItem = Extract<DisplayItem, { kind: 'tool_use' }>
type ToolResultItem = Extract<DisplayItem, { kind: 'tool_result' }>
type Todo = { content?: string; status?: string }

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function relativePath(value: unknown, repoDir: string): string {
  const p = str(value)
  return repoDir && p.startsWith(`${repoDir}/`) ? p.slice(repoDir.length + 1) : p
}

export function toolSummary(name: string, input: Record<string, unknown>, repoDir: string): string {
  switch (name) {
    case 'Bash':
      return str(input.command)
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return relativePath(input.file_path, repoDir)
    case 'NotebookEdit':
      return relativePath(input.notebook_path, repoDir)
    case 'Grep':
      return input.path
        ? `${str(input.pattern)}  (${relativePath(input.path, repoDir)})`
        : str(input.pattern)
    case 'Glob':
      return str(input.pattern)
    case 'WebFetch':
      return str(input.url)
    case 'WebSearch':
      return str(input.query)
    case 'Agent':
    case 'Task':
      return str(input.description)
    case 'Skill':
      return str(input.skill)
    case 'TodoWrite':
      return `${Array.isArray(input.todos) ? input.todos.length : 0} 件のタスク`
    default:
      return Object.values(input).find((v) => typeof v === 'string') ?? ''
  }
}

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <pre className="code diff">
      {oldText.split('\n').map((line, i) => (
        <div key={`d${i}`} className="diff-del">
          {`- ${line}`}
        </div>
      ))}
      {newText.split('\n').map((line, i) => (
        <div key={`a${i}`} className="diff-add">
          {`+ ${line}`}
        </div>
      ))}
    </pre>
  )
}

const TODO_MARKS: Record<string, string> = { completed: '✓', in_progress: '▶', pending: '○' }

export function ToolInputView({ name, input }: { name: string; input: Record<string, unknown> }) {
  switch (name) {
    case 'Bash':
      return (
        <>
          {str(input.description) && <div className="tool-desc">{str(input.description)}</div>}
          <div className="code-block">
            <pre className="code">{str(input.command)}</pre>
            <CopyButton text={str(input.command)} />
          </div>
        </>
      )
    case 'Edit':
      return <DiffView oldText={str(input.old_string)} newText={str(input.new_string)} />
    case 'MultiEdit':
      return (
        <>
          {(Array.isArray(input.edits) ? input.edits : []).map(
            (edit: Record<string, unknown>, i: number) => (
              <DiffView key={i} oldText={str(edit.old_string)} newText={str(edit.new_string)} />
            )
          )}
        </>
      )
    case 'Write':
      return <pre className="code">{str(input.content)}</pre>
    case 'ExitPlanMode':
      return <Markdown text={str(input.plan)} />
    case 'TodoWrite':
      return (
        <ul className="todos">
          {(Array.isArray(input.todos) ? (input.todos as Todo[]) : []).map((todo, i) => (
            <li key={i} className={`todo ${todo.status ?? ''}`}>
              <span className="todo-mark">{TODO_MARKS[todo.status ?? ''] ?? '○'}</span>
              {todo.content}
            </li>
          ))}
        </ul>
      )
    default:
      return <pre className="code">{JSON.stringify(input, null, 2)}</pre>
  }
}

interface Props {
  item: ToolUseItem
  result: ToolResultItem | undefined
  running: boolean
  repoDir: string
  children?: ReactNode
}

export function ToolCard({ item, result, running, repoDir, children }: Props) {
  const [open, setOpen] = useState(item.name === 'TodoWrite')
  const status = result ? (result.isError ? 'error' : 'done') : running ? 'running' : 'stopped'
  const showResult = result && (item.name !== 'TodoWrite' || result.isError)
  return (
    <div className={`tool-card ${status}`}>
      <button className="tool-header" onClick={() => setOpen(!open)}>
        <span className={`tool-caret${open ? ' open' : ''}`}>
          <ChevronIcon />
        </span>
        <span className={`tool-status ${status}`} />
        <span className="tool-name">{item.name}</span>
        <span className="tool-summary">{toolSummary(item.name, item.input, repoDir)}</span>
      </button>
      {open && (
        <div className="tool-body">
          <ToolInputView name={item.name} input={item.input} />
          {children && <div className="subagent">{children}</div>}
          {showResult && (
            <pre className={`code result${result.isError ? ' error' : ''}`}>
              {result.content || '（出力なし）'}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

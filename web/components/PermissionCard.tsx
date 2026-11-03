import { useState } from 'react'

import type { PermissionDecision, PermissionRequest } from '../../shared/protocol'
import { Markdown } from './Markdown'
import { toolSummary, ToolInputView } from './ToolCard'

interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string }[]
}

interface Props {
  request: PermissionRequest
  repoDir: string
  onRespond: (decision: PermissionDecision) => void
}

export function PermissionCard(props: Props) {
  return props.request.toolName === 'AskUserQuestion' ? (
    <QuestionCard {...props} />
  ) : (
    <ToolPermissionCard {...props} />
  )
}

function ToolPermissionCard({ request, repoDir, onRespond }: Props) {
  const [reason, setReason] = useState('')
  const isPlan = request.toolName === 'ExitPlanMode'
  const summary = toolSummary(request.toolName, request.input, repoDir)
  const title =
    request.title ??
    (isPlan ? 'この計画で進めてよいですか？' : `${request.toolName} の実行を許可しますか？`)

  return (
    <div className="permission-card">
      <div className="permission-title">{title}</div>
      {request.description && <div className="permission-desc">{request.description}</div>}
      {!isPlan && summary && <div className="permission-summary">{summary}</div>}
      <div className="permission-body">
        <ToolInputView name={request.toolName} input={request.input} />
      </div>
      <div className="permission-actions">
        <button className="primary" onClick={() => onRespond({ behavior: 'allow' })}>
          {isPlan ? '承認して進める' : '許可'}
        </button>
        {request.canAlwaysAllow && (
          <button onClick={() => onRespond({ behavior: 'allow', always: true })}>今後も許可</button>
        )}
        <input
          className="permission-reason"
          value={reason}
          placeholder="拒否する理由・代わりの指示（任意）"
          onChange={(e) => setReason(e.target.value)}
        />
        <button className="danger" onClick={() => onRespond({ behavior: 'deny', message: reason })}>
          {reason.trim() ? '伝えて拒否' : '拒否'}
        </button>
      </div>
    </div>
  )
}

function QuestionCard({ request, onRespond }: Props) {
  const questions = (
    Array.isArray(request.input.questions) ? request.input.questions : []
  ) as Question[]
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})

  const answerOf = (q: Question) =>
    [...(selected[q.question] ?? []), other[q.question]?.trim() ?? ''].filter(Boolean).join(', ')
  const complete = questions.every((q) => answerOf(q))

  const choose = (q: Question, label: string) => {
    setSelected((prev) => {
      const current = prev[q.question] ?? []
      if (!q.multiSelect) return { ...prev, [q.question]: [label] }
      return {
        ...prev,
        [q.question]: current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label],
      }
    })
    if (!q.multiSelect) setOther((prev) => ({ ...prev, [q.question]: '' }))
  }

  return (
    <div className="permission-card question">
      {questions.map((q) => (
        <div key={q.question} className="question-block">
          <div className="question-text">
            {q.header && <span className="chip">{q.header}</span>}
            {q.question}
            {q.multiSelect && <span className="question-note">（複数選択可）</span>}
          </div>
          <div className="question-options">
            {q.options.map((option) => (
              <button
                key={option.label}
                className={`option${selected[q.question]?.includes(option.label) ? ' selected' : ''}`}
                onClick={() => choose(q, option.label)}
              >
                <span className="option-label">{option.label}</span>
                {option.description && <span className="option-desc">{option.description}</span>}
              </button>
            ))}
          </div>
          <input
            className="question-other"
            placeholder="その他（自由入力）"
            value={other[q.question] ?? ''}
            onChange={(e) => {
              const value = e.target.value
              setOther((prev) => ({ ...prev, [q.question]: value }))
              if (!q.multiSelect && value) setSelected((prev) => ({ ...prev, [q.question]: [] }))
            }}
          />
        </div>
      ))}
      {questions.length === 0 && (
        <Markdown text={'```json\n' + JSON.stringify(request.input, null, 2) + '\n```'} />
      )}
      <div className="permission-actions">
        <button
          className="primary"
          disabled={!complete}
          onClick={() =>
            onRespond({
              behavior: 'allow',
              answers: Object.fromEntries(questions.map((q) => [q.question, answerOf(q)])),
            })
          }
        >
          回答する
        </button>
        <button className="danger" onClick={() => onRespond({ behavior: 'deny' })}>
          回答しない
        </button>
      </div>
    </div>
  )
}

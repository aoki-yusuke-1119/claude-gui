import { randomUUID } from 'node:crypto'

import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'

import type { DisplayItem } from '../shared/protocol'

// 巨大なツール入出力でブラウザが重くならないよう、表示用の文字列は切り詰める
const MAX_TEXT_LENGTH = 20_000

// CLI が会話に差し込む制御用テキスト。ユーザーの発言としては表示しない
const META_TAGS = [
  'system-reminder',
  'local-command-caveat',
  'local-command-stderr',
  'task-notification',
]

type ContentBlock = { type: string; [key: string]: unknown }

export function notice(text: string, level: 'info' | 'error' = 'info'): DisplayItem {
  return { kind: 'notice', id: `notice:${randomUUID()}`, level, text }
}

export function convertHistoryMessage(message: SessionMessage): DisplayItem[] {
  const content = (message.message as { content?: unknown } | null)?.content
  if (message.type === 'assistant') {
    return assistantItems(message.uuid, content, message.parent_tool_use_id)
  }
  if (message.type === 'user') {
    return userItems(message.uuid, content, message.parent_tool_use_id === null)
  }
  return []
}

export function convertSdkMessage(message: SDKMessage): DisplayItem[] {
  switch (message.type) {
    case 'assistant':
      return assistantItems(message.uuid, message.message.content, message.parent_tool_use_id)
    case 'user':
      // ユーザーの発言は送信時に追加済みなので、ツール結果だけを拾う
      return userItems(message.uuid ?? randomUUID(), message.message.content, false)
    case 'result': {
      const base = {
        kind: 'result',
        id: message.uuid,
        durationMs: message.duration_ms,
      } as const
      if (message.subtype === 'success') {
        return [
          message.is_error
            ? { ...base, status: 'error', text: message.result }
            : { ...base, status: 'success', text: null },
        ]
      }
      // 中断・理由なし拒否で止めたターンは CLI の内部診断（[ede_diagnostic] ...）だけが返る
      const errors = message.errors.filter((e) => !e.startsWith('[ede_diagnostic]'))
      if (message.subtype === 'error_during_execution' && errors.length === 0) {
        return [{ ...base, status: 'interrupted', text: null }]
      }
      return [{ ...base, status: 'error', text: errors.join('\n') || null }]
    }
    case 'system':
      switch (message.subtype) {
        case 'compact_boundary':
          return [notice('会話を圧縮しました')]
        case 'api_retry':
          return [
            notice(`API エラーのため再試行しています（${message.attempt}/${message.max_retries}）`),
          ]
        case 'permission_denied':
          return [
            notice(`${message.tool_name} の実行が拒否されました: ${message.message}`, 'error'),
          ]
        case 'informational':
          return [notice(message.content, message.level === 'warning' ? 'error' : 'info')]
        default:
          return []
      }
    default:
      return []
  }
}

function assistantItems(
  uuid: string,
  content: unknown,
  parentToolUseId: string | null
): DisplayItem[] {
  return blocksOf(content).flatMap((block, i): DisplayItem[] => {
    const id = `${uuid}:${i}`
    switch (block.type) {
      case 'text': {
        const text = String(block.text ?? '')
        return text.trim() ? [{ kind: 'assistant', id, text, parentToolUseId }] : []
      }
      case 'thinking': {
        const text = String(block.thinking ?? '')
        return text.trim() ? [{ kind: 'thinking', id, text, parentToolUseId }] : []
      }
      case 'tool_use':
      case 'server_tool_use':
        return [
          {
            kind: 'tool_use',
            id,
            toolUseId: String(block.id),
            name: String(block.name),
            input: truncateInput(block.input),
            parentToolUseId,
          },
        ]
      default:
        return []
    }
  })
}

function userItems(uuid: string, content: unknown, includeText: boolean): DisplayItem[] {
  return blocksOf(content).flatMap((block, i): DisplayItem[] => {
    const id = `${uuid}:${i}`
    if (block.type === 'tool_result') {
      return [
        {
          kind: 'tool_result',
          id,
          toolUseId: String(block.tool_use_id),
          content: truncate(toolResultText(block.content)),
          isError: block.is_error === true,
        },
      ]
    }
    if (!includeText) return []
    if (block.type === 'text') return userTextItems(id, String(block.text ?? ''))
    if (block.type === 'image') return [{ kind: 'user', id, text: '[画像]' }]
    return []
  })
}

function userTextItems(id: string, text: string): DisplayItem[] {
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('Caveat:')) return []
  if (META_TAGS.some((tag) => trimmed.startsWith(`<${tag}>`))) return []
  if (trimmed.startsWith('[Request interrupted')) {
    return [{ kind: 'notice', id, level: 'info', text: '中断しました' }]
  }
  const command = trimmed.match(/<command-name>(.*?)<\/command-name>/s)
  if (command) {
    const args = trimmed.match(/<command-args>(.*?)<\/command-args>/s)?.[1]
    return [{ kind: 'user', id, text: [command[1], args].filter(Boolean).join(' ') }]
  }
  const stdout = trimmed.match(/^<local-command-stdout>(.*)<\/local-command-stdout>$/s)?.[1]
  if (stdout !== undefined) {
    return stdout.trim() ? [{ kind: 'notice', id, level: 'info', text: stdout.trim() }] : []
  }
  return [{ kind: 'user', id, text }]
}

function blocksOf(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? (content as ContentBlock[]) : []
}

function toolResultText(content: unknown): string {
  return blocksOf(content)
    .map((block) => (block.type === 'text' ? String(block.text) : `[${block.type}]`))
    .join('\n')
}

function truncate(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text
  return `${text.slice(0, MAX_TEXT_LENGTH)}\n…（${text.length - MAX_TEXT_LENGTH} 文字省略）`
}

function truncateInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === 'string' ? truncate(value) : value,
    ])
  )
}

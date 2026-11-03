import type { ServerMessage } from '../shared/protocol'

export type TerminalEvent = Extract<
  ServerMessage,
  { type: 'term_snapshot' | 'term_output' | 'term_exit' }
>

// ターミナルの出力は頻度が高いので、React の状態を通さず表示中のターミナルへ直接渡す
const listeners = new Map<string, Set<(event: TerminalEvent) => void>>()

export function isTerminalEvent(message: ServerMessage): message is TerminalEvent {
  return (
    message.type === 'term_snapshot' ||
    message.type === 'term_output' ||
    message.type === 'term_exit'
  )
}

export function emitTerminalEvent(event: TerminalEvent): void {
  listeners.get(event.tabId)?.forEach((listener) => listener(event))
}

export function onTerminalEvent(tabId: string, listener: (event: TerminalEvent) => void) {
  const set = listeners.get(tabId) ?? new Set()
  set.add(listener)
  listeners.set(tabId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(tabId)
  }
}

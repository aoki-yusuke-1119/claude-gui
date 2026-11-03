import type { WebSocket } from 'ws'

import type { ServerMessage } from '../shared/protocol'

const clients = new Set<WebSocket>()

export function addClient(ws: WebSocket): void {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
  // ws は 'error' のリスナーがないと例外を投げてプロセスごと落ちる（送信中に画面を閉じた場合など）
  ws.on('error', (error) => {
    console.error('WebSocket エラー', error.message)
    clients.delete(ws)
  })
}

export function clientCount(): number {
  return clients.size
}

export function sendTo(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

// ローカル専用アプリなので、全タブのイベントを全クライアントへ配信する
export function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message)
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data)
  }
}

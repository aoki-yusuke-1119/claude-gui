import type { ClientMessage, ServerMessage } from '../shared/protocol'

const MAX_RETRY_DELAY_MS = 10_000

// サーバー再起動などで切れたら自動で再接続する WebSocket
export class Socket {
  private ws: WebSocket | null = null
  private retry = 0
  private disposed = false
  private retryTimer: number | undefined

  constructor(
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onConnectionChange: (connected: boolean) => void
  ) {}

  connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}/ws`)
    ws.onopen = () => {
      this.retry = 0
      this.onConnectionChange(true)
    }
    ws.onmessage = (event) => this.onMessage(JSON.parse(String(event.data)) as ServerMessage)
    ws.onclose = () => {
      this.onConnectionChange(false)
      if (this.disposed) return
      const delay = Math.min(500 * 2 ** this.retry++, MAX_RETRY_DELAY_MS)
      this.retryTimer = window.setTimeout(() => this.connect(), delay)
    }
    this.ws = ws
  }

  send(message: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(message))
    return true
  }

  dispose(): void {
    this.disposed = true
    window.clearTimeout(this.retryTimer)
    if (!this.ws) return
    // 破棄後の close 通知で、後から作った接続の状態を上書きしないようにする
    this.ws.onopen = null
    this.ws.onmessage = null
    this.ws.onclose = null
    this.ws.close()
  }
}

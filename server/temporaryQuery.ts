import { type Options, type Query, query } from '@anthropic-ai/claude-agent-sdk'

import { MessageQueue } from './session'

const TIMEOUT_MS = 20 * 1000

// CLI が応答しないまま待ち続けないよう、一定時間で失敗にする
export async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

// 会話を送らない CLI を一時的に起動して問い合わせ、終わったら閉じる（履歴は残さない）
export async function withTemporaryQuery<T>(
  options: Options,
  fn: (q: Query) => Promise<T>
): Promise<T> {
  const queue = new MessageQueue()
  const q = query({ prompt: queue, options: { ...options, persistSession: false } })
  try {
    return await fn(q)
  } finally {
    q.close()
    queue.close()
  }
}

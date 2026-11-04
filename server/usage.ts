import type { Query } from '@anthropic-ai/claude-agent-sdk'

import type { UsageInfo, UsageWindow } from '../shared/protocol'
import { ROOT_DIR } from './config'
import { errorMessage } from './errors'
import { broadcast, clientCount } from './hub'
import { withTemporaryQuery, withTimeout } from './temporaryQuery'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
// 応答完了のたびに問い合わせると複数タブ並行時に多すぎるので間隔をあける
const MIN_TURN_END_INTERVAL_MS = 20 * 1000

type RateWindow = { utilization: number | null; resets_at: string | null } | null | undefined

function toWindow(window: RateWindow): UsageWindow | null {
  return window ? { utilization: window.utilization, resetsAt: window.resets_at } : null
}

// CLI の /usage と同じデータ。SDK 側で実験的 API の扱いなので、形が変わったら取得エラーとして表示する
function fetchUsage(q: Query) {
  return withTimeout(
    q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
    '使用量の取得がタイムアウトしました'
  )
}

// 一時的に起動する CLI では設定ファイルを使わない
function fetchUsageWithTemporaryQuery() {
  return withTemporaryQuery({ cwd: ROOT_DIR, settingSources: [] }, fetchUsage)
}

export class UsageMonitor {
  private current: UsageInfo | null = null
  private inflight: Promise<void> | null = null
  private lastStartedAt = 0
  private timer: NodeJS.Timeout | null = null

  // 稼働中のセッションの CLI があればそれに問い合わせ、なければ一時的に CLI を起動する
  constructor(private readonly activeQuery: () => Query | null) {}

  get usage(): UsageInfo | null {
    return this.current
  }

  start(): void {
    void this.refresh()
    // 画面を開いていない間（ウィンドウを閉じて常駐中など）は CLI を起動してまで取得しない
    this.timer = setInterval(() => {
      if (clientCount() > 0) void this.refresh()
    }, REFRESH_INTERVAL_MS)
  }

  // 画面が開いたとき、前回の取得から時間が経っていれば取り直す
  refreshIfStale(): void {
    if (Date.now() - this.lastStartedAt >= REFRESH_INTERVAL_MS) void this.refresh()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  onTurnEnd(q: Query): void {
    if (Date.now() - this.lastStartedAt < MIN_TURN_END_INTERVAL_MS) return
    void this.refresh(q)
  }

  refresh(via?: Query): Promise<void> {
    this.inflight ??= this.load(via ?? this.activeQuery()).finally(() => (this.inflight = null))
    return this.inflight
  }

  private async load(via: Query | null): Promise<void> {
    this.lastStartedAt = Date.now()
    try {
      const result = via ? await fetchUsage(via) : await fetchUsageWithTemporaryQuery()
      const limits = result.rate_limits
      this.publish(
        result.rate_limits_available && limits
          ? {
              fiveHour: toWindow(limits.five_hour),
              sevenDay: toWindow(limits.seven_day),
              fetchedAt: Date.now(),
              error: null,
            }
          : {
              fiveHour: null,
              sevenDay: null,
              fetchedAt: Date.now(),
              error: 'このアカウントではプランの使用量を取得できません',
            }
      )
    } catch (error) {
      // 失敗時は前回の値を残したままエラーだけ伝える
      this.publish({
        fiveHour: this.current?.fiveHour ?? null,
        sevenDay: this.current?.sevenDay ?? null,
        fetchedAt: this.current?.fetchedAt ?? null,
        error: `使用量を取得できませんでした: ${errorMessage(error)}`,
      })
    }
  }

  private publish(usage: UsageInfo): void {
    this.current = usage
    broadcast({ type: 'usage', usage })
  }
}

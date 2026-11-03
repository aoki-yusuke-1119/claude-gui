// プライベートウィンドウ等で localStorage が使えなくても動くようにする
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // 保存できなくても動作には影響しない
    }
  },
}

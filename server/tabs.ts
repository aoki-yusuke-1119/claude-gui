import fs from 'node:fs/promises'
import path from 'node:path'

import type { TabInfo } from '../shared/protocol'

// タブ一覧を JSON ファイルに永続化する。会話内容は Claude のセッションファイル側にある
export class TabStore {
  private tabs: TabInfo[] = []
  private saving: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly onChange: () => void
  ) {}

  async load(): Promise<void> {
    let text: string
    try {
      text = await fs.readFile(this.file, 'utf8')
    } catch {
      this.tabs = []
      return
    }
    try {
      const data = JSON.parse(text) as { tabs?: TabInfo[] }
      this.tabs = Array.isArray(data.tabs) ? data.tabs : []
    } catch (error) {
      // 壊れたファイルは次の保存で上書きされないよう退避しておく
      const backup = `${this.file}.broken-${Date.now()}`
      await fs.rename(this.file, backup).catch(() => undefined)
      console.error(`タブ情報を読み込めなかったため ${backup} に退避しました`, error)
      this.tabs = []
    }
  }

  list(): TabInfo[] {
    return this.tabs
  }

  get(id: string): TabInfo | undefined {
    return this.tabs.find((t) => t.id === id)
  }

  add(tab: TabInfo): void {
    this.tabs = [...this.tabs, tab]
    this.save()
  }

  update(id: string, patch: Partial<Omit<TabInfo, 'id'>>): TabInfo | undefined {
    let updated: TabInfo | undefined
    this.tabs = this.tabs.map((t) => (t.id === id ? (updated = { ...t, ...patch }) : t))
    if (updated) this.save()
    return updated
  }

  remove(id: string): void {
    this.tabs = this.tabs.filter((t) => t.id !== id)
    this.save()
  }

  private save(): void {
    this.onChange()
    const json = JSON.stringify({ tabs: this.tabs }, null, 2)
    this.saving = this.saving
      .then(async () => {
        // 書き込み途中で終了してもファイルが壊れないよう、一時ファイルに書いてから置き換える
        const tmp = `${this.file}.tmp`
        await fs.mkdir(path.dirname(this.file), { recursive: true })
        await fs.writeFile(tmp, json)
        await fs.rename(tmp, this.file)
      })
      .catch((error) => console.error('タブ情報の保存に失敗しました', error))
  }
}

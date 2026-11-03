import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app, BrowserWindow, dialog, Menu, type Rectangle, shell } from 'electron'

interface AppConfig {
  rootDir: string
  bounds?: Rectangle
}

let mainWindow: BrowserWindow | null = null
let serverUrl = ''

const configFile = () => path.join(app.getPath('userData'), 'config.json')

function readConfig(): Partial<AppConfig> {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8')) as Partial<AppConfig>
  } catch {
    return {}
  }
}

function writeConfig(patch: Partial<AppConfig>): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify({ ...readConfig(), ...patch }, null, 2))
}

// Finder / Dock から起動すると PATH が最小限になり、Claude が実行する Bash や hooks から
// node・git・yarn などが見えなくなるため、ログインシェルの PATH を取り込む
function loadShellPath(): void {
  try {
    const output = execFileSync(
      process.env.SHELL || '/bin/zsh',
      ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const shellPath = output.match(/__PATH__(.*)__PATH__/)?.[1]
    if (shellPath) process.env.PATH = shellPath
  } catch {
    // 取得できなければ既定の PATH のまま起動する
  }
}

function defaultRootDir(): string {
  // 開発中（electron .）はこのリポジトリの親ディレクトリ、.app では ~/Documents/src
  return app.isPackaged
    ? path.join(os.homedir(), 'Documents', 'src')
    : path.resolve(app.getAppPath(), '..')
}

async function chooseRootDir(current?: string): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'リポジトリが入っているフォルダを選択',
    defaultPath: current,
    properties: ['openDirectory'],
  })
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

function buildMenu(rootDir: string): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `${app.name} について` },
        { type: 'separator' },
        {
          label: `リポジトリのフォルダを変更…（現在: ${rootDir}）`,
          click: async () => {
            const dir = await chooseRootDir(rootDir)
            if (!dir || dir === rootDir) return
            writeConfig({ rootDir: dir })
            app.relaunch()
            app.quit()
          },
        },
        { type: 'separator' },
        { role: 'hide', label: `${app.name} を隠す` },
        { role: 'hideOthers', label: 'ほかを隠す' },
        { type: 'separator' },
        { role: 'quit', label: `${app.name} を終了` },
      ],
    },
    { role: 'editMenu', label: '編集' },
    {
      label: '表示',
      submenu: [
        { role: 'reload', label: '再読み込み' },
        { role: 'toggleDevTools', label: '開発者ツール' },
        { type: 'separator' },
        { role: 'resetZoom', label: '実際のサイズ' },
        { role: 'zoomIn', label: '拡大' },
        { role: 'zoomOut', label: '縮小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'フルスクリーン' },
      ],
    },
    { role: 'windowMenu', label: 'ウインドウ' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function openExternal(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url)
}

function createWindow(): void {
  const bounds = readConfig().bounds
  const win = new BrowserWindow({
    width: bounds?.width ?? 1400,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 800,
    minHeight: 500,
    title: 'Claude GUI',
    webPreferences: { contextIsolation: true, sandbox: true },
  })
  // チャット内のリンクはアプリ内ではなく既定のブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(serverUrl)) return
    event.preventDefault()
    openExternal(url)
  })
  win.on('close', () => writeConfig({ bounds: win.getBounds() }))
  win.on('closed', () => (mainWindow = null))
  void win.loadURL(serverUrl)
  mainWindow = win
}

async function start(): Promise<void> {
  // 想定外の Promise の失敗で全セッションごと落ちないよう、ログに残して続行する
  process.on('unhandledRejection', (error) => console.error('unhandledRejection', error))
  loadShellPath()

  let rootDir = readConfig().rootDir ?? defaultRootDir()
  if (!fs.existsSync(rootDir)) {
    const dir = await chooseRootDir()
    if (!dir) {
      app.quit()
      return
    }
    rootDir = dir
  }
  writeConfig({ rootDir })

  // server/config.ts が読み込み時に参照するため、import より前に設定する
  process.env.CLAUDE_GUI_ROOT = rootDir
  process.env.CLAUDE_GUI_DATA_DIR = app.getPath('userData')
  const { startServer } = await import('../server/index')

  let server: Awaited<ReturnType<typeof startServer>>
  try {
    server = await startServer()
  } catch (error) {
    const inUse = (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    dialog.showErrorBox(
      'Claude GUI を起動できませんでした',
      inUse
        ? `ポート ${process.env.PORT ?? 3939} が使用中です。ブラウザ版（yarn start）が起動していれば停止してください。`
        : String(error)
    )
    app.quit()
    return
  }
  serverUrl = server.url
  app.on('before-quit', () => server.close())

  buildMenu(rootDir)
  createWindow()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  // macOS の慣習どおり、ウィンドウを閉じてもアプリ（実行中のセッション）は残し、Dock から開き直せるようにする
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (!mainWindow && serverUrl) createWindow()
  })
  void app.whenReady().then(start)
}

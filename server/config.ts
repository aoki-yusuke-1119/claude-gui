import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// リポジトリを探すディレクトリ。既定はこのアプリの親ディレクトリ
export const ROOT_DIR = path.resolve(process.env.CLAUDE_GUI_ROOT ?? path.join(APP_DIR, '..'))
export const PORT = Number(process.env.PORT ?? 3939)
// デスクトップアプリではアプリのユーザーデータ領域を指定する
export const DATA_FILE = path.join(
  process.env.CLAUDE_GUI_DATA_DIR ?? path.join(APP_DIR, 'data'),
  'tabs.json'
)
export const DIST_DIR = path.join(APP_DIR, 'dist')

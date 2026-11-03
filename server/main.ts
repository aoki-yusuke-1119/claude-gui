// ブラウザで使うときのエントリポイント（yarn start / yarn dev）
import { ROOT_DIR, startServer } from './index'

// 想定外の Promise の失敗で全セッションごと落ちないよう、ログに残して続行する
process.on('unhandledRejection', (error) => console.error('unhandledRejection', error))

const { url, close } = await startServer()
console.log(`Claude GUI: ${url}  (対象: ${ROOT_DIR})`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    close()
    process.exit(0)
  })
}

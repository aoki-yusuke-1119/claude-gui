import { useEffect, useState } from 'react'

import { copyText } from '../clipboard'

interface Props {
  // 描画後の DOM から読む場合は関数で渡す
  text: string | (() => string)
}

export function CopyButton({ text }: Props) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (status === 'idle') return
    const timer = window.setTimeout(() => setStatus('idle'), 1500)
    return () => window.clearTimeout(timer)
  }, [status])

  return (
    <button
      className={`copy-button ${status}`}
      title="クリップボードにコピー"
      onClick={(e) => {
        e.stopPropagation()
        copyText(typeof text === 'function' ? text() : text).then(
          () => setStatus('copied'),
          () => setStatus('failed')
        )
      }}
    >
      {status === 'copied' ? 'コピーしました' : status === 'failed' ? 'コピー失敗' : 'コピー'}
    </button>
  )
}

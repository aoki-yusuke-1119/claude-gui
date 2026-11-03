import { type ComponentProps, memo, useRef, useState } from 'react'
import ReactMarkdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { copyText } from '../clipboard'
import { CopyButton } from './CopyButton'

function CodeBlock({ node: _node, ...props }: ComponentProps<'pre'> & ExtraProps) {
  const ref = useRef<HTMLPreElement>(null)
  return (
    <div className="code-block">
      <pre ref={ref} {...props} />
      <CopyButton text={() => (ref.current?.textContent ?? '').replace(/\n$/, '')} />
    </div>
  )
}

// 文中の `コマンド` はクリックでコピーできるようにする（コードブロック内の code は対象外）
function InlineCode({ node: _node, ...props }: ComponentProps<'code'> & ExtraProps) {
  const [copied, setCopied] = useState(false)
  return (
    <code
      {...props}
      className={[props.className, copied ? 'copied' : ''].filter(Boolean).join(' ') || undefined}
      onClick={(e) => {
        const el = e.currentTarget
        if (el.parentElement?.tagName === 'PRE' || window.getSelection()?.toString()) return
        void copyText(el.textContent ?? '').then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    />
  )
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          pre: CodeBlock,
          code: InlineCode,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

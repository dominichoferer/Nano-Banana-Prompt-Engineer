import { useRef, useEffect, useState } from 'react'
import type { AnalysisStatus } from '../types'

interface Props {
  prompt: string
  onChange: (value: string) => void
  status: AnalysisStatus
}

export default function PromptDisplay({ prompt, onChange, status }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [copied, setCopied] = useState(false)

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [prompt])

  // Auto-scroll while streaming
  useEffect(() => {
    if (status === 'analyzing' && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight
    }
  }, [prompt, status])

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isEmpty = !prompt.trim()

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">

      {/* Prompt area */}
      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            status === 'analyzing'
              ? ''
              : 'Your structured prompt will appear here…\n\nUpload reference images, describe what you want, and click "Generate Prompt".'
          }
          className={`
            w-full min-h-[420px] resize-none rounded-2xl
            bg-[#111] border border-[#2a2a2a] text-white
            font-mono text-xs leading-relaxed p-4
            focus:outline-none focus:border-banana-500/40
            placeholder:text-dark-500 whitespace-pre
            ${status === 'analyzing' ? 'typing-cursor' : ''}
          `}
          readOnly={status === 'analyzing'}
          spellCheck={false}
        />

        {/* Analyzing badge */}
        {status === 'analyzing' && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-[#0a0a0a]/90 px-2.5 py-1.5 rounded-lg border border-banana-500/30">
            <div className="w-1.5 h-1.5 rounded-full bg-banana-500 animate-pulse" />
            <span className="text-banana-400 text-xs font-medium">Claude is writing…</span>
          </div>
        )}
      </div>

      {/* Footer bar */}
      {!isEmpty && status !== 'analyzing' && (
        <div className="flex items-center justify-between animate-fade-in">
          <span className="text-dark-500 text-xs">{prompt.length.toLocaleString()} chars · {prompt.split('\n').length} lines</span>

          <div className="flex gap-2">
            {/* Copy button — main CTA */}
            <button
              onClick={copyToClipboard}
              className={`
                flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200
                ${copied
                  ? 'bg-green-500/20 border border-green-500/40 text-green-400'
                  : 'bg-banana-500 hover:bg-banana-400 text-black'
                }
              `}
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Prompt
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

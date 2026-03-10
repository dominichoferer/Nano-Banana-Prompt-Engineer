import { useRef, useEffect } from 'react'
import type { AnalysisStatus, AspectRatio } from '../types'

interface Props {
  prompt: string
  onChange: (value: string) => void
  status: AnalysisStatus
  aspectRatio: AspectRatio
  onAspectRatioChange: (ratio: AspectRatio) => void
  onGenerate: () => void
  isGenerating: boolean
}

const ASPECT_RATIOS: { value: AspectRatio; label: string; icon: string }[] = [
  { value: '1:1',  label: 'Square',    icon: '⬜' },
  { value: '16:9', label: 'Landscape', icon: '🖥️' },
  { value: '9:16', label: 'Portrait',  icon: '📱' },
  { value: '4:3',  label: '4:3',       icon: '📺' },
  { value: '3:4',  label: '3:4',       icon: '📄' },
]

const PROMPT_ENHANCERS = [
  'ultra-realistic',
  'photorealistic',
  '8K resolution',
  'highly detailed',
  'professional photography',
  'cinematic',
  'masterpiece',
  'award-winning',
  'sharp focus',
  'studio lighting',
]

export default function PromptDisplay({
  prompt,
  onChange,
  status,
  aspectRatio,
  onAspectRatioChange,
  onGenerate,
  isGenerating,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 280)}px`
  }, [prompt])

  // Scroll to bottom while streaming
  useEffect(() => {
    if (status === 'analyzing' && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight
    }
  }, [prompt, status])

  const addEnhancer = (enhancer: string) => {
    if (prompt.includes(enhancer)) return
    const sep = prompt.trim().endsWith(',') ? ' ' : ', '
    onChange(prompt.trim() ? `${prompt.trim()}${sep}${enhancer}` : enhancer)
  }

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(prompt)
  }

  const charCount = prompt.length

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Prompt Textarea */}
      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            status === 'analyzing'
              ? ''
              : 'Your AI-generated prompt will appear here...\n\nUpload reference images and click "Analyze Images" to generate a detailed prompt.'
          }
          className={`
            w-full min-h-[160px] max-h-[280px] resize-none
            input-field font-mono text-sm leading-relaxed
            ${status === 'analyzing' ? 'typing-cursor' : ''}
          `}
          readOnly={status === 'analyzing'}
        />

        {/* Character count + copy */}
        {prompt.length > 0 && (
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <span className="text-dark-500 text-xs">{charCount} chars</span>
            <button
              onClick={copyToClipboard}
              className="btn-ghost p-1.5 text-dark-400 hover:text-banana-500"
              title="Copy to clipboard"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        )}

        {/* Analyzing indicator */}
        {status === 'analyzing' && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-[#0a0a0a]/80 px-2 py-1 rounded-lg">
            <div className="w-1.5 h-1.5 rounded-full bg-banana-500 animate-pulse" />
            <span className="text-banana-500 text-xs font-medium">Analyzing…</span>
          </div>
        )}
      </div>

      {/* Prompt Enhancers */}
      {prompt.length > 0 && status !== 'analyzing' && (
        <div className="flex flex-col gap-2 animate-fade-in">
          <span className="section-label">Quick Enhancers</span>
          <div className="flex flex-wrap gap-1.5">
            {PROMPT_ENHANCERS.map((e) => {
              const active = prompt.includes(e)
              return (
                <button
                  key={e}
                  onClick={() => addEnhancer(e)}
                  className={`
                    text-xs px-2.5 py-1 rounded-lg border transition-all duration-150
                    ${active
                      ? 'border-banana-500/60 bg-banana-500/10 text-banana-400 cursor-default'
                      : 'border-[#3a3a3a] text-dark-400 hover:border-banana-500/40 hover:text-white hover:bg-[#2a2a2a] cursor-pointer'
                    }
                  `}
                >
                  {active ? '✓ ' : '+ '}{e}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Aspect Ratio Selector */}
      <div className="flex flex-col gap-2">
        <span className="section-label">Aspect Ratio</span>
        <div className="flex gap-1.5 flex-wrap">
          {ASPECT_RATIOS.map((r) => (
            <button
              key={r.value}
              onClick={() => onAspectRatioChange(r.value)}
              className={`
                flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border transition-all duration-150
                ${aspectRatio === r.value
                  ? 'border-banana-500 bg-banana-500/10 text-banana-400 font-semibold'
                  : 'border-[#3a3a3a] text-dark-400 hover:border-[#4a4a4a] hover:text-white'
                }
              `}
            >
              <span>{r.icon}</span>
              <span>{r.label}</span>
              <span className="text-dark-500">({r.value})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Generate Button */}
      <button
        onClick={onGenerate}
        disabled={!prompt.trim() || isGenerating}
        className="btn-primary w-full justify-center py-4 text-base"
      >
        {isGenerating ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating Image…
          </>
        ) : (
          <>
            <span>✨</span>
            Generate Image (Gemini 3 Pro)
          </>
        )}
      </button>
    </div>
  )
}

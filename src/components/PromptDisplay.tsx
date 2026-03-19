import { useRef, useEffect, useState } from 'react'
import type { AnalysisStatus, UploadedImage } from '../types'

interface Props {
  prompt: string
  onChange: (value: string) => void
  status: AnalysisStatus
  images: UploadedImage[]
}

const CopyIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
)

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

export default function PromptDisplay({ prompt, onChange, status, images }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [promptCopied, setPromptCopied] = useState(false)
  const [imageCopied, setImageCopied] = useState(false)

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [prompt])

  useEffect(() => {
    if (status === 'analyzing' && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight
    }
  }, [prompt, status])

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(prompt)
    setPromptCopied(true)
    setTimeout(() => setPromptCopied(false), 2000)
  }

  const handleCopyImage = async () => {
    if (images.length === 0 || !('ClipboardItem' in window)) return
    try {
      const bmp = await createImageBitmap(images[0].file)
      const canvas = document.createElement('canvas')
      canvas.width = bmp.width
      canvas.height = bmp.height
      canvas.getContext('2d')!.drawImage(bmp, 0, 0)
      const pngBlob = await new Promise<Blob>((res) =>
        canvas.toBlob((b) => res(b!), 'image/png'),
      )
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
      setImageCopied(true)
      setTimeout(() => setImageCopied(false), 2000)
    } catch {
      // fallback: ignore silently
    }
  }

  const isEmpty = !prompt.trim()
  const hasImages = images.length > 0

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">

      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            status === 'analyzing'
              ? ''
              : 'Dein strukturierter Prompt erscheint hier…\n\nLade Referenzbilder hoch, beschreibe was du möchtest, und klicke "Prompt generieren".'
          }
          className={`
            w-full min-h-[420px] resize-none rounded-2xl
            bg-cream-50 border border-cream-200 text-ink-900
            font-mono text-xs leading-relaxed p-4
            focus:outline-none focus:border-banana-400 focus:ring-2 focus:ring-banana-200
            placeholder:text-ink-300 whitespace-pre shadow-card
            transition-all duration-200
            ${status === 'analyzing' ? 'typing-cursor' : ''}
          `}
          readOnly={status === 'analyzing'}
          spellCheck={false}
        />

        {status === 'analyzing' && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-white/90 px-2.5 py-1.5 rounded-lg border border-banana-200 shadow-card">
            <div className="w-1.5 h-1.5 rounded-full bg-banana-500 animate-pulse" />
            <span className="text-banana-600 text-xs font-medium">Claude schreibt…</span>
          </div>
        )}
      </div>

      {!isEmpty && status !== 'analyzing' && (
        <div className="flex items-center justify-between animate-fade-in">
          <span className="text-ink-400 text-xs">
            {prompt.length.toLocaleString('de')} Zeichen · {prompt.split('\n').length} Zeilen
          </span>

          <div className="flex gap-2">
            {hasImages && (
              <button
                onClick={handleCopyImage}
                className={`
                  flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200
                  ${imageCopied
                    ? 'bg-green-50 border border-green-300 text-green-700'
                    : 'btn-secondary'
                  }
                `}
              >
                {imageCopied ? <CheckIcon /> : <CopyIcon />}
                {imageCopied ? 'Bild kopiert!' : 'Bild kopieren'}
              </button>
            )}

            <button
              onClick={handleCopyPrompt}
              className={`
                flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200
                ${promptCopied
                  ? 'bg-green-50 border border-green-300 text-green-700'
                  : 'btn-primary'
                }
              `}
            >
              {promptCopied ? <CheckIcon /> : <CopyIcon />}
              {promptCopied ? 'Prompt kopiert!' : 'Prompt kopieren'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

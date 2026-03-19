import type { GenerationStatus } from '../types'

interface Props {
  imageDataUrl: string | null
  status: GenerationStatus
  error: string | null
  prompt: string
  activeModel?: string
}

export default function GeneratedImage({ imageDataUrl, status, error, prompt, activeModel }: Props) {
  const downloadImage = () => {
    if (!imageDataUrl) return
    const a = document.createElement('a')
    a.href = imageDataUrl
    a.download = `nano-banana-${Date.now()}.jpg`
    a.click()
  }

  const copyPrompt = async () => {
    if (prompt) await navigator.clipboard.writeText(prompt)
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Image Container */}
      <div
        className={`
          relative flex-1 min-h-[280px] rounded-2xl overflow-hidden
          bg-cream-50 border border-cream-200 shadow-card
          flex items-center justify-center
        `}
      >
        {status === 'idle' && !imageDataUrl && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-cream-100 border border-cream-200 flex items-center justify-center">
              <svg className="w-8 h-8 text-ink-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-ink-500 text-sm font-medium">Noch kein Bild</p>
              <p className="text-ink-300 text-xs mt-1">
                Erst Prompt generieren, dann<br />„Bild generieren" klicken
              </p>
            </div>
          </div>
        )}

        {status === 'generating' && (
          <div className="flex flex-col items-center gap-4 p-8">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full border-4 border-cream-200" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-banana-500 animate-spin" />
              <div className="absolute inset-3 rounded-full border-2 border-transparent border-t-banana-300 animate-spin-slow" style={{ animationDirection: 'reverse' }} />
              <div className="absolute inset-0 flex items-center justify-center text-2xl">🍌</div>
            </div>
            <div className="text-center">
              <p className="text-ink-800 font-semibold font-display">Generating…</p>
              <p className="text-ink-400 text-sm mt-1">10–30 Sekunden</p>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-banana-400"
                  style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-red-600 font-semibold text-sm">Generierung fehlgeschlagen</p>
              <p className="text-ink-400 text-xs mt-1.5 max-w-xs leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {imageDataUrl && (
          <div className="relative w-full h-full animate-fade-in">
            <img
              src={imageDataUrl}
              alt="Generated image"
              className="w-full h-full object-contain"
            />

            <div className="absolute inset-0 bg-ink-900/0 hover:bg-ink-900/40 transition-all duration-300 group flex items-end justify-center p-4">
              <div className="translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 flex gap-2">
                <button onClick={downloadImage} className="btn-primary py-2 px-4 text-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </button>
                <button onClick={copyPrompt} className="btn-secondary py-2 px-4 text-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Prompt
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {imageDataUrl && status === 'done' && (
        <div className="flex items-center gap-2 animate-slide-up">
          <div className="flex items-center gap-2 flex-1 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-green-700 text-xs font-medium">
              Generiert{activeModel ? ` mit ${activeModel}` : ' — fertig!'}
            </span>
          </div>
          <button onClick={downloadImage} className="btn-primary py-2 px-4 text-sm whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Speichern
          </button>
        </div>
      )}
    </div>
  )
}

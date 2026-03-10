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
          bg-[#141414] border border-[#2a2a2a]
          flex items-center justify-center
        `}
      >
        {status === 'idle' && !imageDataUrl && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#1e1e1e] flex items-center justify-center text-4xl">
              🎨
            </div>
            <div>
              <p className="text-dark-400 text-sm font-medium">No image yet</p>
              <p className="text-dark-500 text-xs mt-1">
                Generate a prompt first, then click<br />"Generate Image with Imagen 3"
              </p>
            </div>
          </div>
        )}

        {status === 'generating' && (
          <div className="flex flex-col items-center gap-4 p-8">
            <div className="relative w-20 h-20">
              {/* Outer ring */}
              <div className="absolute inset-0 rounded-full border-4 border-[#2a2a2a]" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-banana-500 animate-spin" />
              {/* Inner ring */}
              <div className="absolute inset-3 rounded-full border-2 border-transparent border-t-banana-300 animate-spin-slow" style={{ animationDirection: 'reverse' }} />
              {/* Center */}
              <div className="absolute inset-0 flex items-center justify-center text-2xl">🍌</div>
            </div>
            <div className="text-center">
              <p className="text-white font-semibold">Generating with Imagen 3…</p>
              <p className="text-dark-400 text-sm mt-1">This may take 10–30 seconds</p>
            </div>
            {/* Animated dots */}
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-banana-500"
                  style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-3xl">
              ⚠️
            </div>
            <div>
              <p className="text-red-400 font-semibold text-sm">Generation Failed</p>
              <p className="text-dark-400 text-xs mt-1.5 max-w-xs leading-relaxed">{error}</p>
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

            {/* Overlay controls */}
            <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-all duration-300 group flex items-end justify-center p-4">
              <div className="translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 flex gap-2">
                <button
                  onClick={downloadImage}
                  className="btn-primary py-2 px-4 text-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </button>
                <button
                  onClick={copyPrompt}
                  className="btn-secondary py-2 px-4 text-sm"
                >
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

      {/* Download bar when image is ready */}
      {imageDataUrl && status === 'done' && (
        <div className="flex items-center gap-2 animate-slide-up">
          <div className="flex items-center gap-2 flex-1 bg-[#141414] border border-[#2a2a2a] rounded-xl px-3 py-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-green-400 text-xs font-medium">
              Generated{activeModel ? ` with ${activeModel}` : ' successfully'}
            </span>
          </div>
          <button
            onClick={downloadImage}
            className="btn-primary py-2 px-4 text-sm whitespace-nowrap"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Save Image
          </button>
        </div>
      )}
    </div>
  )
}

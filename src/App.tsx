import { useState, useCallback } from 'react'
import ImageUploader from './components/ImageUploader'
import PromptDisplay from './components/PromptDisplay'
import GeneratedImage from './components/GeneratedImage'
import type {
  UploadedImage,
  AnalysisStatus,
  GenerationStatus,
  AspectRatio,
  Resolution,
  GenerateResponse,
} from './types'

export default function App() {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [userDescription, setUserDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [resolution, setResolution] = useState<Resolution>('1K')
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle')
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle')
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [activeModel, setActiveModel] = useState<string | undefined>(undefined)

  // ── Analyze Images with Claude Vision ─────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (images.length === 0) return

    setAnalysisStatus('analyzing')
    setAnalysisError(null)
    setPrompt('')

    try {
      const formData = new FormData()
      images.forEach((img) => formData.append('images', img.file))
      if (userDescription.trim()) formData.append('userDescription', userDescription.trim())

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(err.error || `Server error: ${response.status}`)
      }

      // Read SSE stream
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'text') {
              accumulated += data.text
              setPrompt(accumulated)
            } else if (data.type === 'error') {
              throw new Error(data.error)
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
              throw parseErr
            }
          }
        }
      }

      setAnalysisStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed'
      setAnalysisError(message)
      setAnalysisStatus('error')
    }
  }, [images])

  // ── Generate Image with Gemini 3 Pro ──────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return

    setGenerationStatus('generating')
    setGenerationError(null)
    setGeneratedImage(null)

    try {
      // Include first reference image (≤ 2 MB) so Gemini can use it as visual anchor
      let referenceImage: { data: string; mimeType: string } | undefined
      if (images.length > 0 && images[0].file.size <= 2 * 1024 * 1024) {
        referenceImage = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () =>
            resolve({
              data: (reader.result as string).split(',')[1],
              mimeType: images[0].file.type,
            })
          reader.onerror = reject
          reader.readAsDataURL(images[0].file)
        })
      }

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          aspectRatio,
          resolution,
          ...(referenceImage ? { referenceImage } : {}),
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(err.error || `Server error: ${response.status}`)
      }

      const data = (await response.json()) as GenerateResponse
      setGeneratedImage(data.image)
      setActiveModel(data.model)
      setGenerationStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed'
      setGenerationError(message)
      setGenerationStatus('error')
    }
  }, [prompt, aspectRatio, resolution, images])

  const canAnalyze = images.length > 0 && analysisStatus !== 'analyzing'

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-[#1e1e1e] bg-[#0a0a0a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-3xl">🍌</div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight tracking-tight">
                Nano Banana
                <span className="text-banana-500 ml-1.5">Prompt Engineer</span>
              </h1>
              <p className="text-dark-400 text-xs">Claude Vision × Gemini 3 Pro</p>
            </div>
          </div>

          {/* Pipeline indicator */}
          <div className="hidden md:flex items-center gap-2 text-xs text-dark-500">
            <span className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${
              analysisStatus === 'analyzing'
                ? 'border-banana-500/40 bg-banana-500/10 text-banana-400'
                : analysisStatus === 'done'
                ? 'border-green-500/30 bg-green-500/10 text-green-400'
                : 'border-[#2a2a2a] text-dark-500'
            }`}>
              <span className={`status-dot ${
                analysisStatus === 'analyzing' ? 'bg-banana-500 animate-pulse' :
                analysisStatus === 'done' ? 'bg-green-500' : 'bg-[#3a3a3a]'
              }`} />
              Claude claude-opus-4-6 Analysis
            </span>
            <svg className="w-4 h-4 text-[#3a3a3a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
            </svg>
            <span className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${
              generationStatus === 'generating'
                ? 'border-banana-500/40 bg-banana-500/10 text-banana-400'
                : generationStatus === 'done'
                ? 'border-green-500/30 bg-green-500/10 text-green-400'
                : 'border-[#2a2a2a] text-dark-500'
            }`}>
              <span className={`status-dot ${
                generationStatus === 'generating' ? 'bg-banana-500 animate-pulse' :
                generationStatus === 'done' ? 'bg-green-500' : 'bg-[#3a3a3a]'
              }`} />
              Gemini 3 Pro Generation
            </span>
          </div>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Column 1: Image Upload ──────────────────────────────────────── */}
          <div className="glass-card p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="section-label">Step 1</span>
                <h2 className="text-white font-semibold mt-0.5">Reference Images</h2>
              </div>
              <div className="w-8 h-8 rounded-xl bg-banana-500/10 border border-banana-500/20 flex items-center justify-center text-sm font-bold text-banana-500">
                1
              </div>
            </div>

            <ImageUploader
              images={images}
              onChange={setImages}
              disabled={analysisStatus === 'analyzing'}
            />

            {/* User Description */}
            <div className="flex flex-col gap-2">
              <span className="section-label">Describe what you want (optional)</span>
              <textarea
                value={userDescription}
                onChange={(e) => setUserDescription(e.target.value)}
                disabled={analysisStatus === 'analyzing'}
                placeholder="e.g. A product photo of a sneaker on a clean white background, studio lighting, sharp shadows…"
                className="w-full resize-none input-field text-sm leading-relaxed min-h-[80px] max-h-[160px]"
              />
            </div>

            {/* Analyze Button */}
            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              className="btn-primary w-full justify-center py-3.5"
            >
              {analysisStatus === 'analyzing' ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing with Claude…
                </>
              ) : (
                <>
                  <span>🔍</span>
                  Analyze Images
                </>
              )}
            </button>

            {/* Analysis error */}
            {analysisStatus === 'error' && analysisError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 animate-fade-in">
                <p className="text-red-400 text-xs font-medium">Analysis Error</p>
                <p className="text-red-300/80 text-xs mt-1 leading-relaxed">{analysisError}</p>
              </div>
            )}

            {/* Info box */}
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4">
              <p className="text-dark-300 text-xs leading-relaxed">
                <span className="text-banana-500 font-semibold">Claude claude-opus-4-6</span> analyzes your
                reference images using Vision AI and generates a detailed English prompt
                optimized for image generation.
              </p>
            </div>
          </div>

          {/* ── Column 2: Generated Prompt ─────────────────────────────────── */}
          <div className="glass-card p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="section-label">Step 2</span>
                <h2 className="text-white font-semibold mt-0.5">Generated Prompt</h2>
              </div>
              <div className="w-8 h-8 rounded-xl bg-banana-500/10 border border-banana-500/20 flex items-center justify-center text-sm font-bold text-banana-500">
                2
              </div>
            </div>

            <PromptDisplay
              prompt={prompt}
              onChange={setPrompt}
              status={analysisStatus}
              aspectRatio={aspectRatio}
              onAspectRatioChange={setAspectRatio}
              resolution={resolution}
              onResolutionChange={setResolution}
              onGenerate={handleGenerate}
              isGenerating={generationStatus === 'generating'}
            />

            {/* Generation error */}
            {generationStatus === 'error' && generationError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 animate-fade-in">
                <p className="text-red-400 text-xs font-medium">Generation Error</p>
                <p className="text-red-300/80 text-xs mt-1 leading-relaxed">{generationError}</p>
              </div>
            )}
          </div>

          {/* ── Column 3: Generated Image ──────────────────────────────────── */}
          <div className="glass-card p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="section-label">Step 3</span>
                <h2 className="text-white font-semibold mt-0.5">Generated Image</h2>
              </div>
              <div className="w-8 h-8 rounded-xl bg-banana-500/10 border border-banana-500/20 flex items-center justify-center text-sm font-bold text-banana-500">
                3
              </div>
            </div>

            <GeneratedImage
              imageDataUrl={generatedImage}
              status={generationStatus}
              error={generationError}
              prompt={prompt}
              activeModel={activeModel}
            />
          </div>
        </div>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: '🖼️',
              title: 'Upload Reference Images',
              desc: 'Drag & drop one or multiple reference images. Claude analyzes all of them together to understand your visual style.',
            },
            {
              icon: '🧠',
              title: 'Claude Vision Analyzes',
              desc: 'Claude claude-opus-4-6 with Vision examines composition, lighting, style, colors, and every detail to craft the perfect English prompt.',
            },
            {
              icon: '🎨',
              title: 'Gemini 3 Pro Generates',
              desc: 'Google\'s Gemini 3 Pro Image Preview uses the precision-crafted prompt to generate a new image that matches your reference exactly.',
            },
          ].map((step) => (
            <div
              key={step.title}
              className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-5 flex gap-4"
            >
              <div className="text-3xl mt-0.5 shrink-0">{step.icon}</div>
              <div>
                <h3 className="text-white font-semibold text-sm">{step.title}</h3>
                <p className="text-dark-400 text-xs mt-1.5 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#1e1e1e] mt-8">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <p className="text-dark-500 text-xs">
            🍌 Nano Banana Prompt Engineer
          </p>
          <p className="text-dark-600 text-xs">
            Powered by Claude claude-opus-4-6 Vision + Gemini 3 Pro Image
          </p>
        </div>
      </footer>
    </div>
  )
}

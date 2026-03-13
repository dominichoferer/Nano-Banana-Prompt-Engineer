import { useState, useCallback } from 'react'
import ImageUploader from './components/ImageUploader'
import PromptDisplay from './components/PromptDisplay'
import type { UploadedImage, AnalysisStatus, PromptMode, FocusArea } from './types'
import { FOCUS_AREAS } from './types'

// Compress image to max 1600px longest side, JPEG 85% — keeps payload under Vercel's 4.5MB limit
function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const MAX_PX = 1600
    const QUALITY = 0.85
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => resolve(new File([blob!], file.name, { type: 'image/jpeg' })),
        'image/jpeg',
        QUALITY,
      )
    }
    img.onerror = () => resolve(file) // fallback: send original
    img.src = url
  })
}

export default function App() {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [userDescription, setUserDescription] = useState('')
  const [promptMode, setPromptMode] = useState<PromptMode>('retouch')
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([])
  const [prompt, setPrompt] = useState('')
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle')
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const handleAnalyze = useCallback(async () => {
    if (images.length === 0) return

    setAnalysisStatus('analyzing')
    setAnalysisError(null)
    setPrompt('')

    try {
      // Compress all images before upload (stays under Vercel 4.5MB body limit)
      const compressed = await Promise.all(images.map((img) => compressImage(img.file)))
      const formData = new FormData()
      compressed.forEach((file) => formData.append('images', file))
      if (userDescription.trim()) formData.append('userDescription', userDescription.trim())
      formData.append('promptMode', promptMode)
      if (focusAreas.length > 0) formData.append('focusAreas', focusAreas.join(','))

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(err.error || `Server error: ${response.status}`)
      }

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
  }, [images, userDescription, promptMode, focusAreas])

  const toggleFocus = useCallback((area: FocusArea) => {
    setFocusAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area],
    )
  }, [])

  const canAnalyze = images.length > 0 && analysisStatus !== 'analyzing'

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-[#1e1e1e] bg-[#0a0a0a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-3xl">🍌</div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight tracking-tight">
                Nano Banana
                <span className="text-banana-500 ml-1.5">Prompt Engineer</span>
              </h1>
              <p className="text-dark-400 text-xs">Claude Vision · Strukturierte Prompt-Erstellung</p>
            </div>
          </div>

          {/* Status pill */}
          <div className="hidden md:flex items-center gap-2 text-xs">
            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${
              analysisStatus === 'analyzing'
                ? 'border-banana-500/40 bg-banana-500/10 text-banana-400'
                : analysisStatus === 'done'
                ? 'border-green-500/30 bg-green-500/10 text-green-400'
                : 'border-[#2a2a2a] text-dark-500'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                analysisStatus === 'analyzing' ? 'bg-banana-500 animate-pulse' :
                analysisStatus === 'done' ? 'bg-green-500' : 'bg-[#3a3a3a]'
              }`} />
              {analysisStatus === 'analyzing' ? 'Prompt wird erstellt…' :
               analysisStatus === 'done' ? 'Prompt bereit' : 'Claude Vision bereit'}
            </span>
          </div>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">

          {/* ── Left Panel: Controls (2/5) ──────────────────────────────────── */}
          <div className="lg:col-span-2 flex flex-col gap-5">

            {/* Prompt Mode Toggle */}
            <div className="glass-card p-5 flex flex-col gap-4">
              <div>
                <span className="section-label">Prompt-Modus</span>
                <p className="text-dark-400 text-xs mt-0.5">Wie soll Claude dein Referenzbild interpretieren?</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setPromptMode('retouch')}
                  className={`
                    flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all duration-150
                    ${promptMode === 'retouch'
                      ? 'border-banana-500 bg-banana-500/10'
                      : 'border-[#2a2a2a] hover:border-[#3a3a3a]'
                    }
                  `}
                >
                  <span className="text-base">📷</span>
                  <span className={`text-xs font-semibold ${promptMode === 'retouch' ? 'text-banana-400' : 'text-white'}`}>
                    Foto-Retusche
                  </span>
                  <span className="text-dark-500 text-xs leading-snug">Identität erhalten, korrigieren & verbessern</span>
                </button>
                <button
                  onClick={() => setPromptMode('generation')}
                  className={`
                    flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all duration-150
                    ${promptMode === 'generation'
                      ? 'border-banana-500 bg-banana-500/10'
                      : 'border-[#2a2a2a] hover:border-[#3a3a3a]'
                    }
                  `}
                >
                  <span className="text-base">✨</span>
                  <span className={`text-xs font-semibold ${promptMode === 'generation' ? 'text-banana-400' : 'text-white'}`}>
                    Neu generieren
                  </span>
                  <span className="text-dark-500 text-xs leading-snug">Als visuellen Stil-Guide verwenden</span>
                </button>
              </div>
            </div>

            {/* Image Upload */}
            <div className="glass-card p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="section-label">Schritt 1</span>
                  <h2 className="text-white font-semibold mt-0.5">Referenzbilder</h2>
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
            </div>

            {/* What do you want */}
            <div className="glass-card p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="section-label">Schritt 2</span>
                  <h2 className="text-white font-semibold mt-0.5">
                    {promptMode === 'retouch' ? 'Was korrigieren / ändern' : 'Was generieren'}
                  </h2>
                </div>
                <div className="w-8 h-8 rounded-xl bg-banana-500/10 border border-banana-500/20 flex items-center justify-center text-sm font-bold text-banana-500">
                  2
                </div>
              </div>

              {/* Focus Area Toggles */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-dark-400 text-xs">
                    Fokus-Bereiche
                    <span className="text-dark-600 ml-1">
                      {focusAreas.length === 0 ? '— alle Bereiche' : `— ${focusAreas.length} ausgewählt`}
                    </span>
                  </span>
                  {focusAreas.length > 0 && (
                    <button
                      onClick={() => setFocusAreas([])}
                      className="text-dark-500 hover:text-dark-300 text-xs transition-colors"
                    >
                      leeren
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FOCUS_AREAS.map((area) => {
                    const active = focusAreas.includes(area.id)
                    return (
                      <button
                        key={area.id}
                        title={area.hint}
                        onClick={() => toggleFocus(area.id)}
                        disabled={analysisStatus === 'analyzing'}
                        className={`
                          flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium
                          transition-all duration-150 select-none
                          ${active
                            ? 'border-banana-500 bg-banana-500/15 text-banana-300'
                            : 'border-[#2a2a2a] text-dark-400 hover:border-[#3a3a3a] hover:text-dark-300'
                          }
                          disabled:opacity-40 disabled:cursor-not-allowed
                        `}
                      >
                        <span className="text-sm leading-none">{area.icon}</span>
                        {area.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <textarea
                value={userDescription}
                onChange={(e) => setUserDescription(e.target.value)}
                disabled={analysisStatus === 'analyzing'}
                placeholder={promptMode === 'retouch'
                  ? 'z.B. Schwarzen Hintergrund durch nahtlosen weißen Studio-Hintergrund ersetzen. Haltung korrigieren — beide Personen aufrechter. Näher zusammenbringen, Schultern berühren sich. Professionelle 3-Punkt-Studiobeleuchtung. 8K-Ausgabe, null KI-Artefakte.'
                  : 'z.B. Ein Luxus-Hautpflegeprodukt auf einer Marmoroberfläche, dramatisches Seitenlicht, tiefe Schatten, Editorial-Magazin-Stil…'
                }
                rows={6}
                className="w-full resize-none input-field text-sm leading-relaxed"
              />

              {/* Analyze Button */}
              <button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                className="btn-primary w-full justify-center py-4 text-sm font-semibold"
              >
                {analysisStatus === 'analyzing' ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Claude analysiert…
                  </>
                ) : (
                  <>
                    <span>🔍</span>
                    Prompt generieren
                  </>
                )}
              </button>

              {/* Error */}
              {analysisStatus === 'error' && analysisError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                  <p className="text-red-400 text-xs font-medium">Fehler</p>
                  <p className="text-red-300/80 text-xs mt-1 leading-relaxed">{analysisError}</p>
                </div>
              )}

              {/* Hint */}
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3">
                <p className="text-dark-400 text-xs leading-relaxed">
                  <span className="text-banana-500 font-semibold">Claude claude-opus-4-6</span> analysiert deine
                  Referenzbilder und erstellt einen strukturierten, detaillierten Prompt — direkt bereit für{' '}
                  <span className="text-white font-medium">Nano Banana Pro</span> oder jedes andere KI-Bildtool.
                </p>
              </div>
            </div>
          </div>

          {/* ── Right Panel: Generated Prompt (3/5) ────────────────────────── */}
          <div className="lg:col-span-3 glass-card p-6 flex flex-col gap-5" style={{ minHeight: '600px' }}>
            <div className="flex items-center justify-between">
              <div>
                <span className="section-label">Schritt 3</span>
                <h2 className="text-white font-semibold mt-0.5">Generierter Prompt</h2>
              </div>
              <div className="flex items-center gap-2">
                {analysisStatus === 'done' && (
                  <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded-lg animate-fade-in">
                    Bereit zum Einfügen
                  </span>
                )}
                <div className="w-8 h-8 rounded-xl bg-banana-500/10 border border-banana-500/20 flex items-center justify-center text-sm font-bold text-banana-500">
                  3
                </div>
              </div>
            </div>

            <PromptDisplay
              prompt={prompt}
              onChange={setPrompt}
              status={analysisStatus}
              images={images}
            />
          </div>
        </div>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: '🖼️',
              title: 'Referenzbild hochladen',
              desc: 'Lade das Foto hoch, das du retuschieren oder als Stil-Referenz verwenden möchtest. Mehrere Bilder werden unterstützt.',
            },
            {
              icon: '🧠',
              title: 'Beschreibe, was du möchtest',
              desc: 'Sag Claude, was korrigiert, geändert oder generiert werden soll. Hintergrund, Licht, Pose, Stil — so genau wie du willst.',
            },
            {
              icon: '📋',
              title: 'Kopieren & in Nano Banana einfügen',
              desc: 'Claude erstellt einen strukturierten Prompt mit Face-Lock, Beleuchtungsangaben und Farbgebung — Prompt und Bild werden zusammen kopiert.',
            },
          ].map((step) => (
            <div key={step.title} className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-5 flex gap-4">
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
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <p className="text-dark-500 text-xs">🍌 Nano Banana Prompt Engineer</p>
          <p className="text-dark-600 text-xs">Betrieben von Claude claude-opus-4-6 Vision</p>
        </div>
      </footer>
    </div>
  )
}

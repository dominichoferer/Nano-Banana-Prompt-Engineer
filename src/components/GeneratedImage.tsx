import { useState } from 'react'
import type { GenerationStatus, GenModel } from '../types'
import { GEN_MODELS, ratiosForModel } from '../types'

interface Props {
  imageDataUrl: string | null
  status: GenerationStatus
  error: string | null
  prompt: string
  activeModel?: string
  model?: GenModel
  aspectRatio?: string
}

// ── Shooting Simulation ───────────────────────────────────────────────────────

const SCENARIOS = [
  { id: 'nahaufnahme',     label: '📐 Nahaufnahme',      prompt: 'close-up shot, tight framing, subject fills frame' },
  { id: 'seitenansicht',   label: '🔄 Seitenansicht',    prompt: 'side profile view, 90-degree angle' },
  { id: 'vogelperspektive',label: '🦅 Vogelperspektive', prompt: "bird's eye view, top-down perspective, looking down" },
  { id: 'outdoor',         label: '🌅 Outdoor-Licht',    prompt: 'outdoor setting, natural daylight, environmental portrait' },
  { id: 'dramatisch',      label: '🎭 Dramatisch',        prompt: 'dramatic lighting, strong shadows, high contrast, moody atmosphere' },
  { id: 'weiss_bg',        label: '⬜ Weißer BG',         prompt: 'clean white background, minimalist studio photography' },
  { id: 'nachtlicht',      label: '🌙 Nachtlicht',        prompt: 'night scene, artificial lighting, dark atmospheric mood' },
  { id: 'produktshot',     label: '📦 Produktshot',       prompt: 'professional product photography, clean studio setup, neutral background' },
  { id: 'editorial',       label: '✏️ Editorial',         prompt: 'editorial photography style, fashion magazine aesthetic' },
]

interface ShootingResult {
  id: number
  status: 'generating' | 'done' | 'error'
  imageUrl?: string
  errorMsg?: string
  label: string
}

function buildShootingPrompt(scenarioPrompt: string, customText: string): string {
  const change = [scenarioPrompt, customText.trim()].filter(Boolean).join('. ')
  return `USE THE UPLOADED IMAGE AS STRICT VISUAL REFERENCE. The subject, style, colors, lighting quality, and rendering of the original must be fully preserved.

COMPOSITION CHANGE: ${change}

Preserve EXACTLY from the reference: the subject's appearance, clothing, colors, rendering style, image quality, and all visual details that are NOT part of the composition change.
OUTPUT: ONE single image only. No comparisons, no before/after, no grid.`
}

// Compress a dataUrl to stay under maxBytes (base64 size), reducing quality iteratively
function compressToLimit(dataUrl: string, maxBytes = 3_500_000): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const MAX_DIM = 1600
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const tryQuality = (q: number) => {
        const result = canvas.toDataURL('image/jpeg', q)
        // base64 payload size ~ (result.length - header) * 0.75
        if (result.length * 0.75 <= maxBytes || q <= 0.3) {
          resolve(result)
        } else {
          tryQuality(Math.round((q - 0.1) * 10) / 10)
        }
      }
      tryQuality(0.85)
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

function ShootingPanel({ imageDataUrl, model, aspectRatio }: {
  imageDataUrl: string
  basePrompt: string
  model?: GenModel
  aspectRatio?: string
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [customText, setCustomText] = useState('')
  const [customAsExtra, setCustomAsExtra] = useState(false)
  const [variantCount, setVariantCount] = useState<1 | 2 | 3>(2)
  const [shootModel, setShootModel] = useState<GenModel>(model ?? 'flash')
  const initialRatio = aspectRatio && ratiosForModel(shootModel).includes(aspectRatio) ? aspectRatio : '1:1'
  const [shootRatio, setShootRatio] = useState(initialRatio)
  const shootRatios = ratiosForModel(shootModel)
  const pickShootModel = (m: GenModel) => {
    setShootModel(m)
    if (!ratiosForModel(m).includes(shootRatio)) setShootRatio('1:1')
  }
  const [results, setResults] = useState<ShootingResult[]>([])
  const [running, setRunning] = useState(false)

  const toggle = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const hasCustom = customText.trim().length > 0
  const scenariosActive = selected.size > 0

  const totalImages = scenariosActive
    ? selected.size + (hasCustom && customAsExtra ? 1 : 0)
    : (hasCustom ? variantCount : 0)
  const canRun = totalImages > 0 && !running

  const handleShoot = async () => {
    if (!canRun) return

    const compressed = await compressToLimit(imageDataUrl)
    const [header, imgData] = compressed.split(',')
    const mimeType = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg'
    const referenceImages = [{ mimeType, data: imgData }]

    const jobs: Array<{ label: string; promptText: string }> = []

    if (scenariosActive) {
      SCENARIOS.filter(s => selected.has(s.id)).forEach(s => {
        jobs.push({ label: s.label, promptText: buildShootingPrompt(s.prompt, '') })
      })
      if (hasCustom && customAsExtra) {
        jobs.push({ label: '✏️ Eigene', promptText: buildShootingPrompt('', customText) })
      }
    } else {
      Array.from({ length: variantCount }, (_, i) =>
        jobs.push({ label: `Variation ${i + 1}`, promptText: buildShootingPrompt('', customText) })
      )
    }

    setResults(jobs.map((j, i) => ({ id: i, status: 'generating', label: j.label })))
    setRunning(true)

    await Promise.all(jobs.map(async (job, i) => {
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: job.promptText,
            model: shootModel,
            resolution: '2K',
            aspectRatio: shootRatio,
            referenceImages,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }))
          throw new Error(err.error || `Error ${res.status}`)
        }
        const data = await res.json()
        setResults(prev => prev.map(r => r.id === i ? { ...r, status: 'done', imageUrl: data.image } : r))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unbekannter Fehler'
        setResults(prev => prev.map(r => r.id === i ? { ...r, status: 'error', errorMsg: msg } : r))
      }
    }))

    setRunning(false)
  }

  const download = (url: string, label: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `shooting-${label.replace(/[^\w]/g, '-')}-${Date.now()}.jpg`
    a.click()
  }

  return (
    <div className="flex flex-col gap-3 animate-slide-up">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 border-dashed border-banana-300 bg-banana-50/60 text-banana-700 text-sm font-sans font-semibold hover:bg-banana-50 hover:border-banana-400 transition-all duration-150"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Shooting simulieren — weitere Kompositionen
        <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="bg-banana-50 border border-banana-200 rounded-2xl p-4 flex flex-col gap-4 animate-scale-in">
          <div>
            <p className="label-step mb-1">Shooting-Variationen</p>
            <p className="text-xs font-sans text-ink-400 leading-relaxed">
              Szenarien wählen und/oder eigene Beschreibung eingeben — das Originalbild bleibt die Referenz
            </p>
          </div>

          {/* Scenario chips */}
          <div className="flex flex-col gap-2">
            <span className="label-section">Kamera & Stil</span>
            <div className="flex flex-wrap gap-1.5">
              {SCENARIOS.map(s => (
                <button key={s.id} type="button" onClick={() => toggle(s.id)} disabled={running}
                  className={selected.has(s.id) ? 'chip-change-active' : 'chip-change'}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom text */}
          <div className="flex flex-col gap-2">
            <span className="label-section">
              Eigene Beschreibung <span className="normal-case font-normal text-ink-300">(optional)</span>
            </span>
            <textarea
              value={customText}
              onChange={e => { setCustomText(e.target.value); if (!e.target.value.trim()) setCustomAsExtra(false) }}
              disabled={running}
              placeholder="z.B. Person schaut zur Seite, warmes Abendlicht, lockere Pose, grauer Studio-Hintergrund…"
              rows={3}
              className="input-field resize-none text-sm leading-relaxed"
            />
            {/* Show "add as extra job" toggle only when scenarios are also selected */}
            {scenariosActive && hasCustom && (
              <button
                type="button"
                onClick={() => setCustomAsExtra(v => !v)}
                disabled={running}
                className={`self-start flex items-center gap-1.5 text-xs font-sans font-medium px-3 py-1.5 rounded-lg border transition-all duration-150 ${
                  customAsExtra
                    ? 'bg-banana-100 border-banana-400 text-banana-800'
                    : 'bg-white border-cream-200 text-ink-400 hover:border-banana-300 hover:text-banana-700'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                Zusätzlich als eigenes Bild generieren
              </button>
            )}
          </div>

          {/* Model selector */}
          <div className="flex flex-col gap-2">
            <span className="label-section">Modell</span>
            <div className="bg-cream-100 rounded-xl p-1 flex gap-1">
              {GEN_MODELS.map((m) => (
                <button key={m.id} type="button" onClick={() => pickShootModel(m.id)} disabled={running}
                  className={`mode-btn text-xs py-2 ${shootModel === m.id ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                  {m.icon} {m.label} <span className="text-[10px] opacity-60 ml-0.5">{m.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Aspect ratio */}
          <div className="flex flex-col gap-2">
            <span className="label-section">Format</span>
            <div className="flex flex-wrap gap-1.5">
              {shootRatios.map(r => (
                <button key={r} type="button" onClick={() => setShootRatio(r)} disabled={running}
                  className={`px-3 py-1.5 rounded-lg text-xs font-sans font-medium transition-all ${
                    shootRatio === r ? 'bg-banana-500 text-white shadow-sm' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'
                  }`}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Variant count — only when no scenarios selected */}
          {!scenariosActive && (
            <div className="flex items-center justify-between">
              <span className="label-section">Anzahl Variationen</span>
              <div className="bg-cream-100 rounded-xl p-1 flex gap-1">
                {([1, 2, 3] as const).map(n => (
                  <button key={n} type="button" onClick={() => setVariantCount(n)} disabled={running}
                    className={`mode-btn text-xs py-2 px-4 ${variantCount === n ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                    {n}×
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Info line */}
          {totalImages > 0 && (
            <p className="text-xs font-sans text-banana-700 bg-banana-100 rounded-lg px-3 py-2">
              {scenariosActive
                ? `${selected.size} Szenario${selected.size > 1 ? 's' : ''}${customAsExtra ? ' + eigene Beschreibung' : ''} → ${totalImages} Bild${totalImages > 1 ? 'er' : ''} parallel`
                : `${variantCount} Variation${variantCount > 1 ? 'en' : ''} werden parallel generiert`}
            </p>
          )}

          {/* CTA */}
          <button onClick={handleShoot} disabled={!canRun} className="btn-primary w-full py-3.5 text-sm">
            {running ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Shooting läuft…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {totalImages > 0
                  ? `${totalImages} Shooting-Bild${totalImages > 1 ? 'er' : ''} generieren`
                  : 'Szenario oder Beschreibung wählen'}
              </>
            )}
          </button>

          {/* Results grid */}
          {results.length > 0 && (
            <div className={`grid gap-2 ${results.length === 1 ? 'grid-cols-1' : results.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {results.map(r => (
                <div key={r.id} className="relative rounded-xl overflow-hidden aspect-square bg-cream-100 border border-cream-200">
                  {r.status === 'generating' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                      <div className="w-5 h-5 rounded-full border-2 border-cream-300 border-t-banana-500 animate-spin" />
                      <span className="text-[9px] font-sans text-ink-300">{r.label}</span>
                    </div>
                  )}
                  {r.status === 'done' && r.imageUrl && (
                    <>
                      <img src={r.imageUrl} alt={r.label} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-ink-900/0 hover:bg-ink-900/40 transition-all duration-300 group flex items-end justify-center p-2">
                        <button
                          onClick={() => download(r.imageUrl!, r.label)}
                          className="translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 btn-primary py-1.5 px-3 text-xs"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Speichern
                        </button>
                      </div>
                      <div className="absolute top-1.5 left-1.5 text-[8px] font-bold bg-black/30 text-white rounded px-1.5 py-0.5 leading-tight backdrop-blur-sm">
                        {r.label}
                      </div>
                    </>
                  )}
                  {r.status === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3">
                      <span className="text-red-400 text-xs font-sans font-medium">Fehler</span>
                      {r.errorMsg && (
                        <span className="text-red-300 text-[9px] font-sans text-center leading-tight line-clamp-3">{r.errorMsg}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── GeneratedImage ────────────────────────────────────────────────────────────

export default function GeneratedImage({ imageDataUrl, status, error, prompt, activeModel, model, aspectRatio }: Props) {
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
      <div className="relative flex-1 min-h-[280px] rounded-2xl overflow-hidden bg-cream-50 border border-cream-200 shadow-card flex items-center justify-center">
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
              <p className="text-ink-300 text-xs mt-1">Erst Prompt generieren, dann<br />„Bild generieren" klicken</p>
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
                <div key={i} className="w-2 h-2 rounded-full bg-banana-400"
                  style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
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
            <img src={imageDataUrl} alt="Generated image" className="w-full h-full object-contain" />
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

      {/* Shooting Simulation — only when image is ready */}
      {imageDataUrl && status === 'done' && (
        <ShootingPanel
          imageDataUrl={imageDataUrl}
          basePrompt={prompt}
          model={model}
          aspectRatio={aspectRatio}
        />
      )}
    </div>
  )
}

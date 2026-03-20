import { useState, useCallback, useRef } from 'react'
import PromptDisplay from './components/PromptDisplay'
import GeneratedImage from './components/GeneratedImage'
import type { UploadedImage, AnalysisStatus, GenerationStatus, PromptMode, FocusArea } from './types'
import { CHANGE_AREAS } from './types'

// ── Utilities ────────────────────────────────────────────────────────────────
function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 1600
      const scale = Math.min(1, MAX / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => resolve(new File([blob!], file.name, { type: 'image/jpeg' })),
        'image/jpeg', 0.85,
      )
    }
    img.onerror = () => resolve(file)
    img.src = url
  })
}

function createUploadedImage(file: File): UploadedImage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    preview: URL.createObjectURL(file),
    name: file.name,
    size: file.size,
    faceLock: false,
    objectLock: false,
    customLock: '',
  }
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

// ── Image Card ────────────────────────────────────────────────────────────────
function ImageCard({
  img, index, onRemove, onUpdate, disabled,
}: {
  img: UploadedImage; index: number; onRemove: () => void
  onUpdate: (field: 'faceLock' | 'objectLock' | 'customLock', value: boolean | string) => void
  disabled?: boolean
}) {
  return (
    <div className="card p-3 flex flex-col gap-3 animate-scale-in">
      <div className="flex gap-3 items-start">
        <div className="relative flex-shrink-0">
          <div className="w-16 h-16 rounded-xl overflow-hidden bg-cream-100 shadow-card">
            <img src={img.preview} alt={img.name} className="w-full h-full object-cover" />
          </div>
          <div className="absolute -top-1.5 -left-1.5 bg-banana-500 text-white text-[10px] font-display font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-banana">
            {index + 1}
          </div>
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-ink-700 text-xs font-sans font-medium truncate">{img.name}</p>
          <p className="text-ink-400 text-[11px] font-sans mt-0.5">{formatBytes(img.size)}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button type="button" onClick={() => onUpdate('faceLock', !img.faceLock)} disabled={disabled}
              title="Alle Gesichtsmerkmale pixelgenau erhalten"
              className={img.faceLock ? 'chip-lock-active' : 'chip-lock'}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Gesicht Lock
            </button>
            <button type="button" onClick={() => onUpdate('objectLock', !img.objectLock)} disabled={disabled}
              title="Proportionen, Silhouette und Komposition exakt erhalten"
              className={img.objectLock ? 'chip-lock-active' : 'chip-lock'}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              Objekt Lock
            </button>
          </div>
        </div>
        <button onClick={onRemove} disabled={disabled}
          className="flex-shrink-0 p-1.5 rounded-lg text-ink-300 hover:text-red-500 hover:bg-red-50 transition-all duration-150"
          title="Entfernen">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
          <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-blue-500 text-[11px] font-display font-bold">Lock:</span>
        </div>
        <input type="text" value={img.customLock} onChange={(e) => onUpdate('customLock', e.target.value)}
          disabled={disabled} placeholder="z.B. Tattoo linker Arm, rotes Kleid, Schmuck…"
          className="input-field text-xs pl-[68px] py-2" />
      </div>
    </div>
  )
}

// ── Upload Zone ───────────────────────────────────────────────────────────────
function UploadZone({
  images, onAdd, onRemove, onClear, onUpdateImage, disabled,
}: {
  images: UploadedImage[]; onAdd: (files: FileList | File[]) => void
  onRemove: (id: string) => void; onClear: () => void
  onUpdateImage: (id: string, field: 'faceLock' | 'objectLock' | 'customLock', value: boolean | string) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    if (!disabled) onAdd(e.dataTransfer.files)
  }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); if (!disabled) setDragging(true) }
  const handleDragLeave = () => setDragging(false)

  return (
    <div className="flex flex-col gap-3">
      <div onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-4 border-2 border-dashed rounded-2xl cursor-pointer select-none transition-all duration-200
          ${images.length > 0 ? 'p-5' : 'p-10'}
          ${dragging ? 'drop-zone-active' : 'border-cream-300 bg-cream-50 hover:border-banana-300 hover:bg-banana-50/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { if (e.target.files) onAdd(e.target.files); e.target.value = '' }} disabled={disabled} />
        {images.length === 0 ? (
          <>
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-200 ${dragging ? 'bg-banana-100' : 'bg-white shadow-card'}`}>
              <svg className={`w-7 h-7 transition-colors duration-200 ${dragging ? 'text-banana-500' : 'text-ink-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-display font-semibold text-ink-700 text-base">
                {dragging ? 'Jetzt loslassen' : 'Referenzbild hier ablegen'}
              </p>
              <p className="text-ink-400 text-sm mt-1 font-sans">
                oder <span className="text-banana-600 font-medium underline underline-offset-2">durchsuchen</span> · JPEG, PNG, WebP · max 20 MB
              </p>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-ink-400 text-sm font-sans">
            <svg className="w-4 h-4 text-banana-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Weiteres Bild ablegen oder <span className="text-banana-600 underline underline-offset-2">durchsuchen</span>
          </div>
        )}
      </div>
      {images.length > 0 && (
        <div className="flex flex-col gap-2 animate-slide-up">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-sans text-ink-400">
              {images.length} Bild{images.length !== 1 ? 'er' : ''} — je Bild Lock-Regeln setzen
            </span>
            <button onClick={onClear} disabled={disabled}
              className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-600 hover:bg-red-50">
              Alle entfernen
            </button>
          </div>
          {images.map((img, index) => (
            <ImageCard key={img.id} img={img} index={index}
              onRemove={() => onRemove(img.id)}
              onUpdate={(field, value) => onUpdateImage(img.id, field, value)}
              disabled={disabled} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Job Panel (self-contained per-job state + UI) ─────────────────────────────
function JobPanel({
  jobIndex,
  onAdd,
  onRemove,
  canRemove,
}: {
  jobIndex: number
  onAdd: () => void
  onRemove: () => void
  canRemove: boolean
}) {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [userDescription, setUserDescription] = useState('')
  const [promptMode, setPromptMode] = useState<PromptMode>('retouch')
  const [changeAreas, setChangeAreas] = useState<FocusArea[]>([])
  const [prompt, setPrompt] = useState('')
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle')
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle')
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [generatedModel, setGeneratedModel] = useState<string | undefined>()
  const [selectedModel, setSelectedModel] = useState<'flash' | 'pro'>('flash')
  const [selectedResolution, setSelectedResolution] = useState<'1K' | '2K' | '4K'>('2K')

  const addImages = useCallback((files: FileList | File[]) => {
    const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'))
    setImages((prev) => [...prev, ...accepted.map(createUploadedImage)])
  }, [])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => { const img = prev.find((i) => i.id === id); if (img) URL.revokeObjectURL(img.preview); return prev.filter((i) => i.id !== id) })
  }, [])

  const clearImages = useCallback(() => {
    setImages((prev) => { prev.forEach((i) => URL.revokeObjectURL(i.preview)); return [] })
  }, [])

  const updateImageSetting = useCallback((id: string, field: 'faceLock' | 'objectLock' | 'customLock', value: boolean | string) => {
    setImages((prev) => prev.map((img) => img.id === id ? { ...img, [field]: value } : img))
  }, [])

  const toggleChange = useCallback((area: FocusArea) =>
    setChangeAreas((p) => p.includes(area) ? p.filter((a) => a !== area) : [...p, area]), [])

  const handleAnalyze = useCallback(async () => {
    if (images.length === 0 && promptMode !== 'generation') return
    setAnalysisStatus('analyzing'); setAnalysisError(null); setPrompt('')
    try {
      const compressed = await Promise.all(images.map((img) => compressImage(img.file)))
      const formData = new FormData()
      compressed.forEach((f) => formData.append('images', f))
      const imageSettings = images.map((img) => ({
        name: img.name, faceLock: img.faceLock, objectLock: img.objectLock, customLock: img.customLock.trim(),
      }))
      formData.append('imageSettings', JSON.stringify(imageSettings))
      if (userDescription.trim()) formData.append('userDescription', userDescription.trim())
      formData.append('promptMode', promptMode)
      if (changeAreas.length > 0) formData.append('changeAreas', changeAreas.join(','))

      const response = await fetch('/api/analyze', { method: 'POST', body: formData })
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
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'text') { accumulated += data.text; setPrompt(accumulated) }
            else if (data.type === 'error') throw new Error(data.error)
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
          }
        }
      }
      setAnalysisStatus('done')
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Analyse fehlgeschlagen')
      setAnalysisStatus('error')
    }
  }, [images, userDescription, promptMode, changeAreas])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return
    setGenerationStatus('generating'); setGenerationError(null); setGeneratedImage(null)
    try {
      const referenceImages = await Promise.all(
        images.map((img) => compressImage(img.file).then(
          (compressed) => new Promise<{ mimeType: string; data: string }>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => {
              const dataUrl = reader.result as string
              const [header, data] = dataUrl.split(',')
              resolve({ mimeType: header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg', data })
            }
            reader.readAsDataURL(compressed)
          }),
        ))
      )
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(), model: selectedModel, resolution: selectedResolution,
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `Server error: ${res.status}`)
      }
      const data = await res.json()
      setGeneratedImage(data.image); setGeneratedModel(data.model); setGenerationStatus('done')
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Generierung fehlgeschlagen')
      setGenerationStatus('error')
    }
  }, [prompt, selectedModel, selectedResolution, images])

  const canAnalyze = (images.length > 0 || promptMode === 'generation') && analysisStatus !== 'analyzing'
  const canGenerate = prompt.trim().length > 0 && generationStatus !== 'generating'

  return (
    <div className="flex flex-col gap-5">
      {/* Job label */}
      {jobIndex > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-display font-bold text-ink-300 tracking-widest uppercase">Auftrag {jobIndex + 1}</span>
        </div>
      )}

      {/* Upload Zone */}
      {promptMode === 'generation' && images.length === 0 && (
        <p className="text-center text-xs font-sans text-ink-400">
          <span className="text-banana-600 font-medium">Optional:</span> Stil-Referenzbilder hochladen — oder einfach unten beschreiben.
        </p>
      )}
      <UploadZone images={images} onAdd={addImages} onRemove={removeImage} onClear={clearImages}
        onUpdateImage={updateImageSetting} disabled={analysisStatus === 'analyzing'} />

      {/* Mode Toggle + Settings */}
      <div className="card p-5 flex flex-col gap-5">

        {/* Mode header with + and × */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="label-section">Modus</span>
            <div className="flex items-center gap-2">
              <button onClick={onAdd} title="Neuen Auftrag hinzufügen"
                className="w-7 h-7 rounded-full bg-banana-100 text-banana-600 hover:bg-banana-500 hover:text-white flex items-center justify-center transition-all duration-150 font-bold text-base shadow-sm">
                +
              </button>
              {canRemove && (
                <button onClick={onRemove} title="Diesen Auftrag entfernen"
                  className="w-7 h-7 rounded-full bg-red-50 text-red-400 hover:bg-red-500 hover:text-white flex items-center justify-center transition-all duration-150 text-base shadow-sm">
                  ×
                </button>
              )}
            </div>
          </div>
          <div className="bg-cream-100 rounded-xl p-1 flex gap-1">
            <button onClick={() => setPromptMode('retouch')} className={`mode-btn ${promptMode === 'retouch' ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Foto-Retusche
            </button>
            <button onClick={() => setPromptMode('generation')} className={`mode-btn ${promptMode === 'generation' ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              Neu generieren
            </button>
          </div>
        </div>

        {/* Change areas */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="label-section flex items-center gap-1.5">
              <svg className="w-3 h-3 text-banana-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Ändern (global)
            </span>
            {changeAreas.length > 0 && (
              <button onClick={() => setChangeAreas([])} className="text-ink-400 hover:text-ink-700 text-xs font-sans transition-colors">leeren</button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CHANGE_AREAS.map((area) => (
              <button key={area.id} title={area.hint} onClick={() => toggleChange(area.id)}
                disabled={analysisStatus === 'analyzing'}
                className={changeAreas.includes(area.id) ? 'chip-change-active' : 'chip-change'}>
                {area.icon} {area.label}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-2">
          <span className="label-section">Was möchtest du machen?</span>
          <textarea value={userDescription} onChange={(e) => setUserDescription(e.target.value)}
            disabled={analysisStatus === 'analyzing'}
            placeholder={promptMode === 'retouch'
              ? 'z.B. Person aus Bild 1 behalten, aber Hintergrund von Bild 2 verwenden. Beleuchtung verbessern.'
              : 'z.B. Ein Luxus-Hautpflegeprodukt auf Marmor, dramatisches Seitenlicht, tiefe Schatten, Editorial-Stil…'}
            rows={4} className="input-field resize-none text-sm leading-relaxed" />
        </div>

        {/* CTA */}
        <button onClick={handleAnalyze} disabled={!canAnalyze} className="btn-primary w-full py-4 text-base">
          {analysisStatus === 'analyzing' ? (
            <>
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Claude analysiert…
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Prompt generieren
            </>
          )}
        </button>

        {analysisStatus === 'error' && analysisError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 animate-scale-in">
            <p className="text-red-700 text-sm font-sans font-medium">Fehler beim Analysieren</p>
            <p className="text-red-500 text-xs mt-1 font-sans leading-relaxed">{analysisError}</p>
          </div>
        )}

        <div className="bg-banana-50 border border-banana-200 rounded-xl px-4 py-3">
          <p className="text-ink-500 text-xs font-sans leading-relaxed">
            <span className="text-banana-700 font-semibold">Claude Opus</span> analysiert deine Referenzbilder mit den gesetzten Lock-Regeln und erstellt einen strukturierten, detaillierten Prompt.
          </p>
        </div>
      </div>

      {/* Generated Prompt */}
      {(analysisStatus === 'analyzing' || analysisStatus === 'done' || prompt) && (
        <div className="card p-6 flex flex-col gap-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="label-step">Generierter Prompt</p>
              <h3 className="font-display font-bold text-ink-900 text-lg mt-0.5">Strukturierter AI-Prompt</h3>
            </div>
            {analysisStatus === 'done' && (
              <span className="text-xs font-sans bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full animate-fade-in">
                ✓ Bereit
              </span>
            )}
          </div>
          <PromptDisplay prompt={prompt} onChange={setPrompt} status={analysisStatus} images={images} />
        </div>
      )}

      {/* Image Generation */}
      {(analysisStatus === 'done' || generationStatus !== 'idle') && (
        <div className="card p-6 flex flex-col gap-4 animate-slide-up">
          <div>
            <p className="label-step">Bild generieren</p>
            <h3 className="font-display font-bold text-ink-900 text-lg mt-0.5">KI-Bildgenerierung</h3>
          </div>
          <GeneratedImage imageDataUrl={generatedImage} status={generationStatus}
            error={generationError} prompt={prompt} activeModel={generatedModel} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="label-section">Modell</span>
              <div className="bg-cream-100 rounded-xl p-1 flex gap-1">
                <button onClick={() => setSelectedModel('flash')} className={`mode-btn text-xs py-2 ${selectedModel === 'flash' ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                  ⚡ Flash <span className="text-[10px] opacity-60 ml-0.5">schnell</span>
                </button>
                <button onClick={() => setSelectedModel('pro')} className={`mode-btn text-xs py-2 ${selectedModel === 'pro' ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                  ✦ Pro <span className="text-[10px] opacity-60 ml-0.5">best</span>
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label-section">Auflösung</span>
              <div className="bg-cream-100 rounded-xl p-1 flex gap-1">
                {(['1K', '2K', '4K'] as const).map((r) => (
                  <button key={r} onClick={() => setSelectedResolution(r)} className={`mode-btn text-xs py-2 ${selectedResolution === r ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button onClick={handleGenerate} disabled={!canGenerate} className="btn-primary w-full py-4 text-base">
            {generationStatus === 'generating' ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {selectedModel === 'flash' ? 'Gemini Flash 3.1 generiert…' : 'Nano Banana Pro generiert…'}
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {selectedModel === 'flash' ? 'mit Gemini Flash 3.1 generieren' : 'mit Nano Banana Pro generieren'}
              </>
            )}
          </button>
          {generationStatus === 'error' && generationError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 animate-scale-in">
              <p className="text-red-700 text-sm font-sans font-medium">Fehler bei der Generierung</p>
              <p className="text-red-500 text-xs mt-1 font-sans leading-relaxed">{generationError}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [jobs, setJobs] = useState<number[]>([Date.now()])
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickPrompt, setQuickPrompt] = useState('')
  const [quickModel, setQuickModel] = useState<'flash' | 'pro'>('flash')
  const [quickResolution, setQuickResolution] = useState<'1K' | '2K' | '4K'>('2K')
  const [quickAspectRatio, setQuickAspectRatio] = useState('1:1')
  const [quickStatus, setQuickStatus] = useState<GenerationStatus>('idle')
  const [quickError, setQuickError] = useState<string | null>(null)
  const [quickImage, setQuickImage] = useState<string | null>(null)

  const addJob = useCallback(() => setJobs((prev) => [...prev, Date.now()]), [])
  const removeJob = useCallback((id: number) => setJobs((prev) => prev.filter((j) => j !== id)), [])

  const handleQuickGenerate = useCallback(async () => {
    if (!quickPrompt.trim()) return
    setQuickStatus('generating'); setQuickError(null); setQuickImage(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: quickPrompt.trim(), model: quickModel, resolution: quickResolution, aspectRatio: quickAspectRatio }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `Server error: ${res.status}`)
      }
      const data = await res.json()
      setQuickImage(data.image); setQuickStatus('done')
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : 'Fehler')
      setQuickStatus('error')
    }
  }, [quickPrompt, quickModel, quickResolution, quickAspectRatio])

  return (
    <div className="min-h-dvh flex flex-col bg-cream-50">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-cream-200">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-banana-gradient flex items-center justify-center shadow-banana text-lg">
              🍌
            </div>
            <div>
              <h1 className="font-display font-bold text-ink-900 text-base leading-none tracking-tight">
                Nano Banana
                <span className="text-banana-500 ml-1.5">AI Studio</span>
              </h1>
              <p className="text-ink-400 text-[11px] font-sans mt-0.5">Prompt · Retusche · Bildgenerierung</p>
            </div>
          </div>
          <button onClick={() => setQuickOpen((o) => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-sans font-medium transition-all duration-150 ${quickOpen ? 'bg-banana-500 text-white border-banana-500 shadow-banana' : 'bg-white text-ink-500 border-cream-200 hover:border-banana-300 hover:text-banana-600 shadow-card'}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Quick Generate
          </button>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-white border-b border-cream-200">
        <div className="aurora-blob w-[500px] h-[500px] bg-banana-200/60 animate-aurora-1" style={{ top: '-200px', left: '-100px', opacity: 0.7 }} />
        <div className="aurora-blob w-[400px] h-[400px] bg-amber-100/80 animate-aurora-2" style={{ top: '-100px', right: '-80px', opacity: 0.6 }} />
        <div className="aurora-blob w-[300px] h-[300px] bg-orange-100/60 animate-aurora-3" style={{ bottom: '-100px', left: '40%', opacity: 0.5 }} />
        <div className="relative z-10 max-w-4xl mx-auto px-5 pt-10 pb-8 text-center">
          <p className="label-step mb-3">AI Creative Studio</p>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl text-ink-900 leading-[1.1] tracking-tight">
            Prompt. Retuschieren.
            <br />
            <span className="text-banana-500">Bilder generieren.</span>
          </h2>
          <p className="text-ink-400 font-sans text-base mt-4 max-w-lg mx-auto leading-relaxed">
            Referenzbilder hochladen · Lock-Regeln setzen · Claude generiert den Prompt · Gemini rendert das Bild.
          </p>
        </div>
      </div>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <main className={`${jobs.length > 1 ? 'max-w-7xl' : 'max-w-4xl'} mx-auto w-full px-5 py-8 flex flex-col gap-6`}>

        {/* Quick Generator */}
        {quickOpen && (
          <div className="card p-5 flex flex-col gap-4 animate-slide-up">
            <div>
              <p className="label-step">Schnell generieren</p>
              <h3 className="font-display font-bold text-ink-900 text-lg mt-0.5">Bild direkt erstellen</h3>
            </div>
            <div className="flex gap-2">
              <input type="text" value={quickPrompt} onChange={(e) => setQuickPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && quickPrompt.trim() && quickStatus !== 'generating' && handleQuickGenerate()}
                disabled={quickStatus === 'generating'}
                placeholder="z.B. golden hour portrait, studio product shot, futuristic city…"
                className="input-field flex-1 text-sm" />
              <button onClick={handleQuickGenerate} disabled={!quickPrompt.trim() || quickStatus === 'generating'}
                className="btn-primary px-5 py-3 text-sm whitespace-nowrap">
                {quickStatus === 'generating' ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                {quickStatus === 'generating' ? 'Lädt…' : 'Generieren'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <span className="label-section text-[10px]">Modell</span>
                <div className="bg-cream-100 rounded-xl p-0.5 flex gap-0.5">
                  {(['flash', 'pro'] as const).map((m) => (
                    <button key={m} onClick={() => setQuickModel(m)}
                      className={`mode-btn text-xs py-1.5 ${quickModel === m ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                      {m === 'flash' ? '⚡ Flash' : '✦ Pro'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="label-section text-[10px]">Auflösung</span>
                <div className="bg-cream-100 rounded-xl p-0.5 flex gap-0.5">
                  {(['1K', '2K', '4K'] as const).map((r) => (
                    <button key={r} onClick={() => setQuickResolution(r)}
                      className={`mode-btn text-xs py-1.5 ${quickResolution === r ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="label-section text-[10px]">Format</span>
                <div className="bg-cream-100 rounded-xl p-0.5 flex gap-0.5 flex-wrap">
                  {(['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4'] as const).map((r) => (
                    <button key={r} onClick={() => setQuickAspectRatio(r)}
                      className={`mode-btn text-xs py-1.5 ${quickAspectRatio === r ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {quickStatus === 'error' && quickError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-xs animate-scale-in">{quickError}</div>
            )}
            {quickImage && (
              <div className="relative rounded-2xl overflow-hidden bg-cream-100 animate-scale-in">
                <img src={quickImage} alt="Generated" className="w-full object-contain max-h-[500px]" />
                <div className="absolute bottom-3 right-3">
                  <button onClick={() => { const a = document.createElement('a'); a.href = quickImage!; a.download = `quick-${Date.now()}.jpg`; a.click() }}
                    className="btn-primary py-2 px-3 text-xs">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Speichern
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Job Panels — side by side when multiple */}
        <div className={`flex gap-5 items-start ${jobs.length > 1 ? 'flex-row' : 'flex-col'}`}>
          {jobs.map((id, idx) => (
            <div key={id} className={jobs.length > 1 ? 'flex-1 min-w-0' : 'w-full'}>
              <JobPanel
                jobIndex={idx}
                onAdd={addJob}
                onRemove={() => removeJob(id)}
                canRemove={jobs.length > 1}
              />
            </div>
          ))}
        </div>

      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-cream-200 bg-white mt-auto">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <p className="text-ink-300 text-xs font-sans">🍌 Nano Banana AI Studio</p>
          <p className="text-ink-300 text-xs font-sans">Claude Opus Vision · Gemini Flash & Pro</p>
        </div>
      </footer>
    </div>
  )
}

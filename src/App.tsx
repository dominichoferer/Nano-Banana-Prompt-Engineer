import { useState, useCallback, useRef } from 'react'
import PromptDisplay from './components/PromptDisplay'
import GeneratedImage from './components/GeneratedImage'
import type { UploadedImage, AnalysisStatus, GenerationStatus, PromptMode, FocusArea } from './types'
import { CHANGE_AREAS } from './types'

// Compress image to max 1600px / JPEG 85%
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

// ── Status indicator ──────────────────────────────────────────────────────────
function StatusPill({ status }: { status: AnalysisStatus }) {
  const map = {
    idle:      { dot: 'bg-ink-300', text: 'text-ink-400',  label: 'Bereit', border: 'border-cream-200' },
    analyzing: { dot: 'bg-banana-500 animate-pulse', text: 'text-banana-600', label: 'Claude analysiert…', border: 'border-banana-300' },
    done:      { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Prompt bereit', border: 'border-emerald-200' },
    error:     { dot: 'bg-red-500', text: 'text-red-600', label: 'Fehler', border: 'border-red-200' },
  }
  const s = map[status]
  return (
    <span className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border bg-white text-xs font-sans font-medium shadow-card ${s.border} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

// ── Image Card (per-image controls) ──────────────────────────────────────────
function ImageCard({
  img,
  index,
  onRemove,
  onUpdate,
  disabled,
}: {
  img: UploadedImage
  index: number
  onRemove: () => void
  onUpdate: (field: 'faceLock' | 'objectLock' | 'customLock', value: boolean | string) => void
  disabled?: boolean
}) {
  return (
    <div className="card p-3 flex flex-col gap-3 animate-scale-in">
      {/* Top row: thumbnail + info */}
      <div className="flex gap-3 items-start">
        {/* Image number + thumbnail */}
        <div className="relative flex-shrink-0">
          <div className="w-16 h-16 rounded-xl overflow-hidden bg-cream-100 shadow-card">
            <img src={img.preview} alt={img.name} className="w-full h-full object-cover" />
          </div>
          <div className="absolute -top-1.5 -left-1.5 bg-banana-500 text-white text-[10px] font-display font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-banana">
            {index + 1}
          </div>
        </div>

        {/* Name + size */}
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-ink-700 text-xs font-sans font-medium truncate">{img.name}</p>
          <p className="text-ink-400 text-[11px] font-sans mt-0.5">{formatBytes(img.size)}</p>

          {/* Quick lock chips */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => onUpdate('faceLock', !img.faceLock)}
              disabled={disabled}
              title="Alle Gesichtsmerkmale pixelgenau erhalten"
              className={img.faceLock ? 'chip-lock-active' : 'chip-lock'}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Gesicht Lock
            </button>
            <button
              type="button"
              onClick={() => onUpdate('objectLock', !img.objectLock)}
              disabled={disabled}
              title="Proportionen, Silhouette und Komposition exakt erhalten"
              className={img.objectLock ? 'chip-lock-active' : 'chip-lock'}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              Objekt Lock
            </button>
          </div>
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          disabled={disabled}
          className="flex-shrink-0 p-1.5 rounded-lg text-ink-300 hover:text-red-500 hover:bg-red-50 transition-all duration-150"
          title="Entfernen"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Custom lock field */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
          <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-blue-500 text-[11px] font-display font-bold">Lock:</span>
        </div>
        <input
          type="text"
          value={img.customLock}
          onChange={(e) => onUpdate('customLock', e.target.value)}
          disabled={disabled}
          placeholder="z.B. Tattoo linker Arm, rotes Kleid, Schmuck…"
          className="input-field text-xs pl-[68px] py-2"
        />
      </div>
    </div>
  )
}

// ── Upload zone ───────────────────────────────────────────────────────────────
function UploadZone({
  images, onAdd, onRemove, onClear, onUpdateImage, disabled,
}: {
  images: UploadedImage[]
  onAdd: (files: FileList | File[]) => void
  onRemove: (id: string) => void
  onClear: () => void
  onUpdateImage: (id: string, field: 'faceLock' | 'objectLock' | 'customLock', value: boolean | string) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (!disabled) onAdd(e.dataTransfer.files)
  }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); if (!disabled) setDragging(true) }
  const handleDragLeave = () => setDragging(false)

  return (
    <div className="flex flex-col gap-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-4
          border-2 border-dashed rounded-2xl cursor-pointer select-none
          transition-all duration-200
          ${images.length > 0 ? 'p-5' : 'p-10'}
          ${dragging
            ? 'drop-zone-active'
            : 'border-cream-300 bg-cream-50 hover:border-banana-300 hover:bg-banana-50/50'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) onAdd(e.target.files); e.target.value = '' }}
          disabled={disabled}
        />

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

      {/* Per-image cards */}
      {images.length > 0 && (
        <div className="flex flex-col gap-2 animate-slide-up">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-sans text-ink-400">
              {images.length} Bild{images.length !== 1 ? 'er' : ''} — je Bild Lock-Regeln setzen
            </span>
            <button onClick={onClear} disabled={disabled} className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-600 hover:bg-red-50">
              Alle entfernen
            </button>
          </div>
          {images.map((img, index) => (
            <ImageCard
              key={img.id}
              img={img}
              index={index}
              onRemove={() => onRemove(img.id)}
              onUpdate={(field, value) => onUpdateImage(img.id, field, value)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
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

  const addImages = useCallback((files: FileList | File[]) => {
    const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'))
    const newImgs = accepted.map(createUploadedImage)
    setImages((prev) => [...prev, ...newImgs])
  }, [])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id)
      if (img) URL.revokeObjectURL(img.preview)
      return prev.filter((i) => i.id !== id)
    })
  }, [])

  const clearImages = useCallback(() => {
    setImages((prev) => { prev.forEach((i) => URL.revokeObjectURL(i.preview)); return [] })
  }, [])

  const updateImageSetting = useCallback((
    id: string,
    field: 'faceLock' | 'objectLock' | 'customLock',
    value: boolean | string,
  ) => {
    setImages((prev) => prev.map((img) => img.id === id ? { ...img, [field]: value } : img))
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (images.length === 0) return
    setAnalysisStatus('analyzing')
    setAnalysisError(null)
    setPrompt('')

    try {
      const compressed = await Promise.all(images.map((img) => compressImage(img.file)))
      const formData = new FormData()
      compressed.forEach((f) => formData.append('images', f))

      // Send per-image settings as JSON
      const imageSettings = images.map((img) => ({
        name: img.name,
        faceLock: img.faceLock,
        objectLock: img.objectLock,
        customLock: img.customLock.trim(),
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
    setGenerationStatus('generating')
    setGenerationError(null)
    setGeneratedImage(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `Server error: ${res.status}`)
      }
      const data = await res.json()
      setGeneratedImage(data.image)
      setGeneratedModel(data.model)
      setGenerationStatus('done')
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Generierung fehlgeschlagen')
      setGenerationStatus('error')
    }
  }, [prompt])

  const toggleChange = useCallback((area: FocusArea) =>
    setChangeAreas((p) => p.includes(area) ? p.filter((a) => a !== area) : [...p, area]), [])

  const canAnalyze = (images.length > 0 || promptMode === 'generation') && analysisStatus !== 'analyzing'
  const canGenerate = prompt.trim().length > 0 && generationStatus !== 'generating'

  return (
    <div className="min-h-dvh flex flex-col bg-cream-50">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-cream-200">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-banana-gradient flex items-center justify-center shadow-banana text-lg">
              🍌
            </div>
            <div>
              <h1 className="font-display font-bold text-ink-900 text-base leading-none tracking-tight">
                Nano Banana
                <span className="text-banana-500 ml-1.5">Prompt Engineer</span>
              </h1>
              <p className="text-ink-400 text-[11px] font-sans mt-0.5">Claude Vision · Strukturierte Prompts</p>
            </div>
          </div>
          <StatusPill status={analysisStatus} />
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-white border-b border-cream-200">
        {/* Aurora blobs */}
        <div className="aurora-blob w-[500px] h-[500px] bg-banana-200/60 animate-aurora-1"
          style={{ top: '-200px', left: '-100px', opacity: 0.7 }} />
        <div className="aurora-blob w-[400px] h-[400px] bg-amber-100/80 animate-aurora-2"
          style={{ top: '-100px', right: '-80px', opacity: 0.6 }} />
        <div className="aurora-blob w-[300px] h-[300px] bg-orange-100/60 animate-aurora-3"
          style={{ bottom: '-100px', left: '40%', opacity: 0.5 }} />

        <div className="relative z-10 max-w-4xl mx-auto px-5 pt-12 pb-10">
          <div className="text-center mb-8">
            <p className="label-step mb-3">KI-Prompt Generator</p>
            <h2 className="font-display font-extrabold text-4xl sm:text-5xl text-ink-900 leading-[1.1] tracking-tight">
              Verwandle Fotos in
              <br />
              <span className="text-banana-500">perfekte AI-Prompts.</span>
            </h2>
            <p className="text-ink-400 font-sans text-base mt-4 max-w-lg mx-auto leading-relaxed">
              Bilder hochladen · Lock-Regeln pro Bild setzen · Claude erstellt den perfekten strukturierten Prompt.
            </p>
          </div>

          {/* Upload Zone */}
          {promptMode === 'generation' && (
            <p className="text-center text-xs font-sans text-ink-400 -mb-1">
              <span className="text-banana-600 font-medium">Optional:</span> Stil-Referenzbilder hochladen — oder einfach unten beschreiben, was generiert werden soll.
            </p>
          )}
          <UploadZone
            images={images}
            onAdd={addImages}
            onRemove={removeImage}
            onClear={clearImages}
            onUpdateImage={updateImageSetting}
            disabled={analysisStatus === 'analyzing'}
          />
        </div>
      </div>

      {/* ── Controls ────────────────────────────────────────────────────────── */}
      <main className="max-w-4xl mx-auto w-full px-5 py-8 flex flex-col gap-6">

        {/* Mode Toggle + Settings Card */}
        <div className="card p-5 flex flex-col gap-5 animate-slide-up">

          {/* Mode toggle */}
          <div className="flex flex-col gap-2">
            <span className="label-section">Modus</span>
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

          {/* Change areas — global */}
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
                <button key={area.id} title={area.hint}
                  onClick={() => toggleChange(area.id)}
                  disabled={analysisStatus === 'analyzing'}
                  className={changeAreas.includes(area.id) ? 'chip-change-active' : 'chip-change'}
                >
                  {area.icon} {area.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-2">
            <span className="label-section">Was möchtest du machen?</span>
            <textarea
              value={userDescription}
              onChange={(e) => setUserDescription(e.target.value)}
              disabled={analysisStatus === 'analyzing'}
              placeholder={promptMode === 'retouch'
                ? 'z.B. Person aus Bild 1 behalten, aber Hintergrund von Bild 2 verwenden. Beleuchtung verbessern. Oder: Kopf von Bild 2 auf den Körper von Bild 1 setzen.'
                : 'z.B. Ein Luxus-Hautpflegeprodukt auf Marmor, dramatisches Seitenlicht, tiefe Schatten, Editorial-Stil…'
              }
              rows={4}
              className="input-field resize-none text-sm leading-relaxed"
            />
          </div>

          {/* CTA Button */}
          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className="btn-primary w-full py-4 text-base"
          >
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

          {/* Error state */}
          {analysisStatus === 'error' && analysisError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 animate-scale-in">
              <p className="text-red-700 text-sm font-sans font-medium">Fehler beim Analysieren</p>
              <p className="text-red-500 text-xs mt-1 font-sans leading-relaxed">{analysisError}</p>
            </div>
          )}

          {/* Info hint */}
          <div className="bg-banana-50 border border-banana-200 rounded-xl px-4 py-3">
            <p className="text-ink-500 text-xs font-sans leading-relaxed">
              <span className="text-banana-700 font-semibold">Claude Opus</span> analysiert deine Referenzbilder mit den gesetzten Lock-Regeln und erstellt einen strukturierten, detaillierten Prompt — bereit für{' '}
              <span className="text-ink-700 font-medium">Nano Banana Pro</span> oder jedes andere KI-Bildtool.
            </p>
          </div>
        </div>

        {/* ── Generated Prompt ─────────────────────────────────────────────── */}
        {(analysisStatus === 'analyzing' || analysisStatus === 'done' || prompt) && (
          <div className="card p-6 flex flex-col gap-4 animate-slide-up">
            <div className="flex items-center justify-between">
              <div>
                <p className="label-step">Schritt 3</p>
                <h3 className="font-display font-bold text-ink-900 text-lg mt-0.5">Generierter Prompt</h3>
              </div>
              {analysisStatus === 'done' && (
                <span className="text-xs font-sans bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full animate-fade-in">
                  ✓ Bereit
                </span>
              )}
            </div>
            <PromptDisplay
              prompt={prompt}
              onChange={setPrompt}
              status={analysisStatus}
              images={images}
            />
          </div>
        )}

        {/* ── Image Generation ─────────────────────────────────────────────── */}
        {(analysisStatus === 'done' || generationStatus !== 'idle') && (
          <div className="card p-6 flex flex-col gap-4 animate-slide-up">
            <div>
              <p className="label-step">Schritt 4</p>
              <h3 className="font-display font-bold text-ink-900 text-lg mt-0.5">Bild generieren</h3>
            </div>

            <GeneratedImage
              imageDataUrl={generatedImage}
              status={generationStatus}
              error={generationError}
              prompt={prompt}
              activeModel={generatedModel}
            />

            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="btn-primary w-full py-4 text-base"
            >
              {generationStatus === 'generating' ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Gemini generiert…
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Bild generieren (Gemini 2.0)
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

        {/* ── How it works ─────────────────────────────────────────────────── */}
        {analysisStatus === 'idle' && !prompt && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-fade-in">
            {[
              { step: '01', icon: '🖼️', title: 'Bilder hochladen', desc: 'Lade ein oder mehrere Fotos hoch. Jedes Bild bekommt eine Nummer und eigene Lock-Regeln.' },
              { step: '02', icon: '🔒', title: 'Locks & Änderungen', desc: 'Setze Face/Objekt-Lock pro Bild. Beschreibe was sich ändern soll — auch bildspezifisch.' },
              { step: '03', icon: '✨', title: 'Prompt kopieren', desc: 'Claude erstellt einen strukturierten Prompt mit expliziten Bild-Referenzen und Lock-Regeln.' },
            ].map((s) => (
              <div key={s.step} className="card p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{s.icon}</span>
                  <span className="font-display font-bold text-4xl text-cream-300">{s.step}</span>
                </div>
                <div>
                  <h4 className="font-display font-bold text-ink-800 text-sm">{s.title}</h4>
                  <p className="text-ink-400 text-xs font-sans mt-1 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-cream-200 bg-white mt-auto">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <p className="text-ink-300 text-xs font-sans">🍌 Nano Banana Prompt Engineer</p>
          <p className="text-ink-300 text-xs font-sans">Claude Opus Vision · Gemini 2.0 Flash</p>
        </div>
      </footer>
    </div>
  )
}

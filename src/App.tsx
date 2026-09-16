import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import PromptDisplay from './components/PromptDisplay'
import GeneratedImage from './components/GeneratedImage'
import type { UploadedImage, AnalysisStatus, GenerationStatus, PromptMode, FocusArea, MockupType, GenModel, GenFamilie, OpenAIFormat } from './types'
import { CHANGE_AREAS, MOCKUP_TYPES, GEN_MODELS, GEN_FAMILIEN, OPENAI_FORMATS, ratiosForModel,
  STANDARD_MODELL, istGpt, familieVon, kannTransparenz, modellDef } from './types'
import type { RefRolle, RefBild } from './referenzen'
import { ROLLEN_REGEL, baueLegende, begrenze } from './referenzen'
import { willGesichtLock, identitaetsKlausel } from './identitaet'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

// ── Utilities ────────────────────────────────────────────────────────────────
async function renderPdfFirstPageToFile(file: File): Promise<File> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 2.0 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(new File([blob!], file.name.replace(/\.pdf$/i, '.jpg'), { type: 'image/jpeg' })), 'image/jpeg', 0.9)
  )
}

// Bis hierher lief JEDES hochgeladene Bild durch JPEG 0.85 — auch ein 12-KB-
// Thumbnail, das dadurch weiter verlor. Genau solche Artefakte hält das
// Bildmodell später für Hautmerkmale und malt sie gross aus. Wer ohnehin unter
// der Maximalkante liegt und klein genug ist, wird jetzt unverändert
// durchgelassen.
const KOMPRESS_MAXKANTE = 1600
const KOMPRESS_SCHONFRIST_BYTES = 900 * 1024

function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = KOMPRESS_MAXKANTE
      if (Math.max(img.width, img.height) <= MAX && file.size <= KOMPRESS_SCHONFRIST_BYTES) {
        resolve(file)
        return
      }
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
    rolle: 'ausgang',
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
  onUpdate: (field: 'faceLock' | 'objectLock' | 'customLock' | 'rolle', value: boolean | string) => void
  disabled?: boolean
}) {
  return (
    <div className="card p-3 flex flex-col gap-3 animate-scale-in">
      <div className="flex gap-3 items-start">
        <div className="relative flex-shrink-0">
          <div className="w-16 h-16 rounded-xl overflow-hidden bg-cream-100 shadow-card flex items-center justify-center">
            {img.file.type === 'application/pdf' ? (
              <div className="flex flex-col items-center gap-0.5">
                <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span className="text-[9px] font-display font-bold text-red-400 uppercase">PDF</span>
              </div>
            ) : (
              <img src={img.preview} alt={img.name} className="w-full h-full object-cover" />
            )}
          </div>
          <div className="absolute -top-1.5 -left-1.5 bg-heron-500 text-white text-[10px] font-display font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {index + 1}
          </div>
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-ink-700 text-xs font-sans font-medium truncate">{img.name}</p>
          <p className="text-ink-400 text-[11px] font-sans mt-0.5">
            {formatBytes(img.size)}
            {img.breite && img.hoehe ? ` · ${img.breite}×${img.hoehe}` : ''}
          </p>
          {/* Auflösungshinweis gehört VOR die Generierung — hinterher ist das
              Bild bezahlt. Die kurze Kante entscheidet, nicht die Fläche. */}
          {img.breite && img.hoehe && Math.min(img.breite, img.hoehe) < 900 && (
            <p className={`text-[10px] font-sans mt-0.5 ${Math.min(img.breite, img.hoehe) < 500 ? 'text-red-600' : 'text-heron-600'}`}>
              {Math.min(img.breite, img.hoehe) < 500
                ? 'Sehr klein — Details werden erfunden, Gesichter können fleckig werden.'
                : 'Knapp — für scharfe Details lieber eine größere Fassung.'}
            </p>
          )}
          {/* Rolle: Ausgangsmaterial wird originalgetreu übernommen, die
              Zielreferenz gibt nur Anmutung vor. Ohne diese Trennung nimmt das
              Bildmodell Inhalte (und Gesichter) aus dem falschen Bild. */}
          <div className="flex gap-1 mt-2">
            {([
              ['ausgang', 'Ausgangsmaterial', 'Woraus etwas entsteht — wird originalgetreu übernommen, samt Gesicht'],
              ['ziel', 'Zielreferenz', 'Wie das Ergebnis aussehen soll: Farbe, Licht, Perspektive, Ausschnitt — NICHT die Objekte oder Personen daraus'],
            ] as Array<[RefRolle, string, string]>).map(([r, beschriftung, titel]) => (
              <button key={r} type="button" onClick={() => onUpdate('rolle', r)} disabled={disabled}
                title={titel}
                className={`px-2 py-1 rounded-lg text-[10px] font-sans font-medium transition-all
                  ${img.rolle === r ? 'bg-heron-500 text-white shadow-sm' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'}`}>
                {beschriftung}
              </button>
            ))}
          </div>
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
          <svg className="w-3 h-3 text-heron-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-heron-600 text-[11px] font-display font-bold">Lock:</span>
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
  onUpdateImage: (id: string, field: 'faceLock' | 'objectLock' | 'customLock' | 'rolle', value: boolean | string) => void
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
          ${dragging ? 'drop-zone-active' : 'border-cream-300 bg-cream-50 hover:border-heron-300 hover:bg-heron-50/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
          onChange={(e) => { if (e.target.files) onAdd(e.target.files); e.target.value = '' }} disabled={disabled} />
        {images.length === 0 ? (
          <>
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-200 ${dragging ? 'bg-heron-100' : 'bg-white shadow-card'}`}>
              <svg className={`w-7 h-7 transition-colors duration-200 ${dragging ? 'text-heron-500' : 'text-ink-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-display font-semibold text-ink-700 text-base">
                {dragging ? 'Jetzt loslassen' : 'Referenzbild hier ablegen'}
              </p>
              <p className="text-ink-400 text-sm mt-1 font-sans">
                oder <span className="text-heron-600 font-medium underline underline-offset-2">durchsuchen</span> · JPEG, PNG, WebP, PDF · max 50 MB
              </p>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-ink-400 text-sm font-sans">
            <svg className="w-4 h-4 text-heron-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Weiteres Bild ablegen oder <span className="text-heron-600 underline underline-offset-2">durchsuchen</span>
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
  onAdd,
  onRemove,
  canRemove,
}: {
  onAdd: () => void
  onRemove: () => void
  canRemove: boolean
}) {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [userDescription, setUserDescription] = useState('')
  const [promptMode, setPromptMode] = useState<PromptMode>('retouch')
  const [changeAreas, setChangeAreas] = useState<FocusArea[]>([])
  const [mockupType, setMockupType] = useState<MockupType | ''>('')
  const [mockupEnvironment, setMockupEnvironment] = useState<'light' | 'dark' | ''>('')
  const [prompt, setPrompt] = useState('')
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle')
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle')
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [generatedModel, setGeneratedModel] = useState<string | undefined>()
  // Fünf Modelle passen nicht mehr als Kacheln nebeneinander: ein Schalter je
  // Anbieter-Familie, darin ein Dropdown mit den Modellen dieser Familie.
  //
  // Wichtig: Familie und gewähltes Modell sind GETRENNTER State. Läge nur das
  // aktive Modell im State, ginge beim Wechsel der Familie die Modellwahl in
  // der anderen jedes Mal verloren.
  const [aktiveFamilie, setAktiveFamilie] = useState<GenFamilie>(familieVon(STANDARD_MODELL))
  const [familienModell, setFamilienModell] = useState<Record<GenFamilie, GenModel>>(
    { gpt: STANDARD_MODELL, nano: 'pro' })
  const selectedModel = familienModell[aktiveFamilie]
  const [selectedResolution, setSelectedResolution] = useState<'1K' | '2K' | '4K' | 'auto'>('2K')
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('1:1')
  const [selectedOutputFormat, setSelectedOutputFormat] = useState<OpenAIFormat>('auto')
  // Freistellen können nur die gpt-image-2.5-Modelle. Der Schalter verschwindet
  // bei allen anderen, statt still wirkungslos zu bleiben.
  const [transparent, setTransparent] = useState(false)

  const availableRatios = ratiosForModel(selectedModel)
  const availableResolutions: Array<'auto' | '1K' | '2K' | '4K'> =
    istGpt(selectedModel) ? ['auto', '1K', '2K', '4K'] : ['1K', '2K', '4K']
  /** Auflösung und Format an ein Modell anpassen, das sie vielleicht nicht kennt. */
  const passeEinstellungenAn = (m: GenModel) => {
    if (!ratiosForModel(m).includes(selectedAspectRatio)) setSelectedAspectRatio('1:1')
    if (!istGpt(m) && selectedResolution === 'auto') setSelectedResolution('2K')
    if (!kannTransparenz(m)) setTransparent(false)
  }
  const pickFamilie = (f: GenFamilie) => {
    setAktiveFamilie(f)
    passeEinstellungenAn(familienModell[f])
  }
  // Wer im Dropdown etwas aussucht, will damit rechnen — also Familie mit aktivieren.
  const setzeModell = (f: GenFamilie, m: GenModel) => {
    setFamilienModell((prev) => ({ ...prev, [f]: m }))
    setAktiveFamilie(f)
    passeEinstellungenAn(m)
  }

  const addImages = useCallback((files: FileList | File[]) => {
    const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf'])
    const accepted = Array.from(files).filter((f) => {
      if (f.type.startsWith('image/') || f.type === 'application/pdf') return true
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return IMAGE_EXTS.has(ext)
    })
    const neue = accepted.map(createUploadedImage)
    setImages((prev) => [...prev, ...neue])
    // Maße nachtragen, sobald sie bekannt sind — für den Auflösungshinweis.
    for (const eintrag of neue) {
      if (eintrag.file.type === 'application/pdf') continue
      const messbild = new Image()
      messbild.onload = () => setImages((prev) => prev.map((i) =>
        i.id === eintrag.id ? { ...i, breite: messbild.width, hoehe: messbild.height } : i))
      messbild.src = eintrag.preview
    }
  }, [])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => { const img = prev.find((i) => i.id === id); if (img) URL.revokeObjectURL(img.preview); return prev.filter((i) => i.id !== id) })
  }, [])

  const clearImages = useCallback(() => {
    setImages((prev) => { prev.forEach((i) => URL.revokeObjectURL(i.preview)); return [] })
  }, [])

  const updateImageSetting = useCallback((id: string, field: 'faceLock' | 'objectLock' | 'customLock' | 'rolle', value: boolean | string) => {
    setImages((prev) => prev.map((img) => img.id === id ? { ...img, [field]: value } : img))
  }, [])

  /**
   * Die verbindliche Reihenfolge der Bilder: erst Ausgangsmaterial, dann
   * Zielreferenz, dann Personen.
   *
   * Sie wird EINMAL festgelegt und von beiden Seiten benutzt — vom
   * Prompt-Schreiber und vom Bildmodell. Würde jede Seite für sich nummerieren,
   * meinte „IMAGE 2" im Prompt ein anderes Bild als beim Bildmodell, und
   * niemand sähe den Fehler. `begrenze` kappt zu lange Listen so, dass das
   * Ausgangsmaterial als Letztes fällt.
   */
  const ROLLEN_ORDNUNG: RefRolle[] = ['ausgang', 'ziel', 'person']
  const geordneteBilder = useMemo(
    () => [...images].sort((a, b) => ROLLEN_ORDNUNG.indexOf(a.rolle) - ROLLEN_ORDNUNG.indexOf(b.rolle)),
    [images])
  /** Bildnummern (1-basiert) je Rolle — für die Identitätsklausel. */
  const nummernMit = (rolle: RefRolle) => geordneteBilder
    .map((b, i) => ({ b, nr: i + 1 })).filter((x) => x.b.rolle === rolle).map((x) => x.nr)

  const toggleChange = useCallback((area: FocusArea) =>
    setChangeAreas((p) => p.includes(area) ? p.filter((a) => a !== area) : [...p, area]), [])

  const handleAnalyze = useCallback(async () => {
    if (images.length === 0 && promptMode !== 'generation') return
    setAnalysisStatus('analyzing'); setAnalysisError(null); setPrompt('')
    try {
      const compressed = await Promise.all(geordneteBilder.map((img) =>
        img.file.type === 'application/pdf' ? Promise.resolve(img.file) : compressImage(img.file)))
      const formData = new FormData()
      compressed.forEach((f) => formData.append('images', f))
      // Der Gesicht-Lock setzt sich selbst, wenn der Auftragstext ihn sinngemäß
      // verlangt („Gesicht von der Vorlage", „gleiche Person"). Sonst bleibt
      // der Wunsch bloßer Fließtext und landet bestenfalls unter „Änderungen",
      // also als weiche Bitte statt als pixelgenaue Auflage.
      const gesichtErzwungen = willGesichtLock(userDescription)
      const imageSettings = geordneteBilder.map((img) => ({
        name: img.name,
        rolle: img.rolle,
        rollenRegel: ROLLEN_REGEL[img.rolle],
        faceLock: img.faceLock || (gesichtErzwungen && img.rolle === 'ausgang'),
        objectLock: img.objectLock,
        customLock: img.customLock.trim(),
      }))
      formData.append('imageSettings', JSON.stringify(imageSettings))
      if (userDescription.trim()) formData.append('userDescription', userDescription.trim())
      formData.append('promptMode', promptMode)
      if (changeAreas.length > 0) formData.append('changeAreas', changeAreas.join(','))
      if (promptMode === 'mockup' && mockupType) formData.append('mockupType', mockupType)
      if (promptMode === 'mockup' && mockupEnvironment) formData.append('mockupEnvironment', mockupEnvironment)

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
  }, [geordneteBilder, userDescription, promptMode, changeAreas, mockupType, mockupEnvironment])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return
    setGenerationStatus('generating'); setGenerationError(null); setGeneratedImage(null)
    try {
      const bilder = begrenze(geordneteBilder)
      const referenceImages = await Promise.all(
        bilder.map((img) => (img.file.type === 'application/pdf' ? renderPdfFirstPageToFile(img.file) : compressImage(img.file)).then(
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
      // Legende VOR den Prompt: Sie sagt für jede Bildnummer, was das Bild ist
      // und wie damit umzugehen ist. Die Identitätsklausel ans ENDE — beim
      // Bildmodell wiegt das zuletzt Gelesene schwerer, und die Identität muss
      // jede freiere Formulierung davor überstimmen.
      const rollenListe: RefBild[] = bilder.map((img, i) => ({
        ...referenceImages[i], rolle: img.rolle, zeigt: img.name,
      }))
      const legende = baueLegende(rollenListe)
      const klausel = identitaetsKlausel(nummernMit('ausgang'), nummernMit('ziel'))
      const volltext = [legende, prompt.trim(), klausel].filter(Boolean).join('\n\n')

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: volltext, model: selectedModel, resolution: selectedResolution, aspectRatio: selectedAspectRatio,
          outputFormat: istGpt(selectedModel) ? selectedOutputFormat : undefined,
          transparent: kannTransparenz(selectedModel) && transparent ? true : undefined,
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
  }, [prompt, selectedModel, selectedResolution, selectedAspectRatio, selectedOutputFormat, transparent, images])

  const canAnalyze = (images.length > 0 || promptMode === 'generation') && analysisStatus !== 'analyzing'
  const canGenerate = prompt.trim().length > 0 && generationStatus !== 'generating'

  return (
    <div className="flex flex-col gap-5">

      {/* Upload Zone */}
      {promptMode === 'generation' && images.length === 0 && (
        <p className="text-center text-xs font-sans text-ink-400">
          <span className="text-heron-600 font-medium">Optional:</span> Stil-Referenzbilder hochladen — oder einfach unten beschreiben.
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
                className="w-7 h-7 rounded-full bg-heron-100 text-heron-600 hover:bg-heron-500 hover:text-white flex items-center justify-center transition-all duration-150 shadow-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              {canRemove && (
                <button onClick={onRemove} title="Diesen Auftrag entfernen"
                  className="w-7 h-7 rounded-full bg-red-50 text-red-400 hover:bg-red-500 hover:text-white flex items-center justify-center transition-all duration-150 shadow-sm">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
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
            <button onClick={() => setPromptMode('mockup')} className={`mode-btn ${promptMode === 'mockup' ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Mockup
            </button>
            <button onClick={() => setPromptMode('generation')} className={`mode-btn ${promptMode === 'generation' ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              Neu generieren
            </button>
          </div>
        </div>

        {/* Mockup options — only in mockup mode */}
        {promptMode === 'mockup' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="label-section">Mockup-Art</span>
                {mockupType && <button onClick={() => setMockupType('')} className="text-ink-400 hover:text-ink-700 text-xs font-sans transition-colors">leeren</button>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MOCKUP_TYPES.map((t) => (
                  <button key={t.id} onClick={() => setMockupType(mockupType === t.id ? '' : t.id)}
                    disabled={analysisStatus === 'analyzing'}
                    className={`chip-change ${mockupType === t.id ? 'chip-change-active' : ''}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="label-section">Umfeld-Farbgebung</span>
              <div className="flex gap-2">
                {([['light', 'Hell'], ['dark', 'Dunkel']] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setMockupEnvironment(mockupEnvironment === val ? '' : val)}
                    disabled={analysisStatus === 'analyzing'}
                    className={`chip-change ${mockupEnvironment === val ? 'chip-change-active' : ''}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Change areas — only for retouch mode */}
        {promptMode === 'retouch' && <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="label-section flex items-center gap-1.5">
              <svg className="w-3 h-3 text-heron-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                {area.label}
              </button>
            ))}
          </div>
        </div>}

        {/* Description */}
        <div className="flex flex-col gap-2">
          <span className="label-section">Was möchtest du machen?</span>
          <textarea value={userDescription} onChange={(e) => setUserDescription(e.target.value)}
            disabled={analysisStatus === 'analyzing'}
            placeholder={
              promptMode === 'retouch' ? 'z.B. Person aus Bild 1 behalten, aber Hintergrund von Bild 2 verwenden. Beleuchtung verbessern.' :
              promptMode === 'mockup'   ? 'z.B. Logo auf weißem Grund, corporate blau als Akzentfarbe…' :
              'z.B. Ein Luxus-Hautpflegeprodukt auf Marmor, dramatisches Seitenlicht, tiefe Schatten, Editorial-Stil…'
            }
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

        <div className="bg-heron-50 border border-heron-200 rounded-xl px-4 py-3">
          <p className="text-ink-500 text-xs font-sans leading-relaxed">
            <span className="text-heron-700 font-semibold">Claude Sonnet</span> analysiert deine Referenzbilder mit den gesetzten Lock-Regeln und erstellt einen strukturierten, detaillierten Prompt.
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
            error={generationError} prompt={prompt} activeModel={generatedModel}
            model={selectedModel} aspectRatio={selectedAspectRatio}
            onClear={() => {
              setGeneratedImage(null)
              setGeneratedModel(undefined)
              setGenerationStatus('idle')
              setGenerationError(null)
            }} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="label-section">Modell</span>
              {/* Ein Schalter je Anbieter, darunter die Modellwahl. Der Hover
                  erklärt Stärken und ungefähre Kosten — die Modellnamen allein
                  sagen niemandem, was er bestellt. Auf dem Telefon gibt es kein
                  Hover, deshalb steht dasselbe noch einmal unter dem Dropdown. */}
              <div className="grid grid-cols-2 gap-2">
                {GEN_FAMILIEN.map((f) => {
                  const aktiv = aktiveFamilie === f.id
                  const modelle = GEN_MODELS.filter((m) => m.familie === f.id)
                  const gewaehlt = modellDef(familienModell[f.id])
                  return (
                    <div key={f.id} className="flex flex-col gap-1">
                      <div className="relative group">
                        <button onClick={() => pickFamilie(f.id)}
                          className={`mode-btn w-full !flex-col gap-0.5 text-xs py-2.5 leading-tight text-center
                            ${aktiv ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                          <span className="text-sm">{f.label}</span>
                          <span className="text-[10px] opacity-60">{gewaehlt.label}</span>
                        </button>
                        <div className="hidden sm:block pointer-events-none absolute z-30 left-0 right-0 bottom-full mb-2
                          opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <div className="bg-ink-900 text-white rounded-xl p-3 shadow-lg flex flex-col gap-1.5">
                            <span className="font-sans font-semibold text-xs">{f.label}</span>
                            <span className="font-sans text-[11px] leading-snug opacity-90">{f.koennen}</span>
                            <span className="font-sans text-[11px] text-heron-300">{f.preis}</span>
                            <span className="font-sans text-[10px] opacity-60 leading-snug">
                              {modelle.map((m) => `${m.label}: ${m.staerke}`).join(' · ')}
                            </span>
                          </div>
                        </div>
                      </div>
                      <select value={familienModell[f.id]}
                        onChange={(e) => setzeModell(f.id, e.target.value as GenModel)}
                        className={`w-full bg-cream-100 rounded-lg border-0 text-xs font-sans py-2 px-2 cursor-pointer
                          focus:outline-none focus:ring-1 focus:ring-heron-500
                          ${aktiv ? 'text-ink-700' : 'text-ink-400'}`}>
                        {modelle.map((m) => (
                          <option key={m.id} value={m.id}>{m.label} — {m.hint}</option>
                        ))}
                      </select>
                      <span className="text-[10px] font-sans text-ink-400 leading-snug px-0.5">
                        {gewaehlt.staerke} · {gewaehlt.preis[selectedResolution === 'auto' ? '2K' : selectedResolution]} je Bild
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label-section">Auflösung</span>
              <div className="bg-cream-100 rounded-xl p-1 flex gap-1">
                {availableResolutions.map((r) => (
                  <button key={r} onClick={() => setSelectedResolution(r)} className={`mode-btn text-xs py-2 ${selectedResolution === r ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                    {r === 'auto' ? 'Auto' : r}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="label-section">Format</span>
            <div className="flex flex-wrap gap-1.5">
              {availableRatios.map((r) => (
                <button key={r} onClick={() => setSelectedAspectRatio(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-sans font-medium transition-all ${selectedAspectRatio === r ? 'bg-heron-500 text-white shadow-sm' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'}`}>
                  {r === 'auto' ? 'Auto' : r}
                </button>
              ))}
            </div>
            {istGpt(selectedModel) && (
              <p className="text-[11px] font-sans text-ink-400 mt-0.5">
                {modellDef(selectedModel).hint} rendert in jedem Format nativ — 4K erreicht max. ~8.3 MP (z.B. 3840×2160 bei 16:9, 2880×2880 bei 1:1, 3072×2048 bei 3:2).
              </p>
            )}
          </div>
          {kannTransparenz(selectedModel) && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
                className="mt-0.5 accent-heron-500" />
              <span className="flex flex-col">
                <span className="text-xs font-sans font-medium text-ink-700">Freigestellt ausgeben</span>
                <span className="text-[10px] font-sans text-ink-400 leading-snug">
                  Transparenter Hintergrund. Nur gpt-image-2.5 kann das, und nur in
                  PNG oder WebP — JPEG hat keinen Alphakanal, dort wird auf PNG gewechselt.
                </span>
              </span>
            </label>
          )}
          {istGpt(selectedModel) && (
            <div className="flex flex-col gap-1.5">
              <span className="label-section">Output-Format</span>
              <div className="bg-cream-100 rounded-xl p-1 flex gap-1">
                {OPENAI_FORMATS.map((f) => (
                  <button key={f} onClick={() => setSelectedOutputFormat(f)}
                    className={`mode-btn text-xs py-2 ${selectedOutputFormat === f ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                    {f === 'auto' ? 'Auto' : f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button onClick={handleGenerate} disabled={!canGenerate} className="btn-primary w-full py-4 text-base">
            {generationStatus === 'generating' ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {modellDef(selectedModel).label} generiert…
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                mit {modellDef(selectedModel).label} generieren
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

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (email: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim(), password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Anmeldung fehlgeschlagen' }))
        throw new Error(data.error || 'Anmeldung fehlgeschlagen')
      }
      const data = await res.json()
      onLogin(data.email)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-cream-50 relative overflow-hidden px-5">

      <form onSubmit={submit} className="relative z-10 card p-8 w-full max-w-sm flex flex-col gap-5 animate-scale-in">
        <div className="flex flex-col items-center gap-3">
          <img src="/heron-logo.png" alt="HERON Innovationsfactory" className="h-16 w-auto" />
          <div className="text-center">
            <h1 className="font-display font-bold text-ink-800 text-xl uppercase tracking-wide">
              AI Studio
            </h1>
            <p className="text-ink-400 text-xs font-sans mt-1">Bitte anmelden, um fortzufahren</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="label-section">E-Mail</label>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
              disabled={loading} required placeholder="name@heron.at" className="input-field text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label-section">Passwort</label>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
              disabled={loading} required placeholder="••••••••" className="input-field text-sm" />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 animate-scale-in">
            <p className="text-red-600 text-xs font-sans">{error}</p>
          </div>
        )}

        <button type="submit" disabled={loading || !email.trim() || !password}
          className="btn-primary w-full py-3 text-sm">
          {loading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Wird angemeldet…
            </>
          ) : 'Anmelden'}
        </button>
      </form>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  // Der Server sperrt mit 503, wenn AUTH_USERS/AUTH_SECRET fehlen oder kaputt
  // sind. Dann hilft kein Anmeldeformular — es kann gar nicht funktionieren.
  const [konfigFehler, setKonfigFehler] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (cancelled) return
        if (r.status === 503) setKonfigFehler(data.error ?? 'Anmeldung ist nicht eingerichtet')
        setAuthEnabled(!!data.authEnabled)
        setUserEmail(data.email ?? null)
        setAuthChecked(true)
      })
      .catch(() => { if (!cancelled) setAuthChecked(true) })
    return () => { cancelled = true }
  }, [])

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
    setUserEmail(null)
  }, [])

  if (!authChecked) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-cream-50">
        <svg className="w-6 h-6 animate-spin text-heron-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  if (konfigFehler) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-cream-50 p-6">
        <div className="card max-w-lg w-full p-8 flex flex-col gap-4">
          <img src="/heron-logo.png" alt="HERON Innovationsfactory" className="h-12 w-auto self-start" />
          <h1 className="font-display font-bold text-ink-800 text-xl uppercase tracking-wide">Zugriff gesperrt</h1>
          <p className="font-sans text-sm text-ink-600 leading-relaxed">{konfigFehler}</p>
          <p className="font-sans text-xs text-ink-400 leading-relaxed">
            Das ist kein Fehler deiner Anmeldung. Die Umgebungsvariablen
            {' '}<code className="font-mono">AUTH_USERS</code> und
            {' '}<code className="font-mono">AUTH_SECRET</code> müssen in Vercel gesetzt und
            gültig sein. Bis dahin bleibt alles zu — damit die Seite nicht offen im Netz steht.
          </p>
        </div>
      </div>
    )
  }

  if (authEnabled && !userEmail) {
    return <LoginScreen onLogin={setUserEmail} />
  }

  return <AppMain userEmail={userEmail} authEnabled={authEnabled} onLogout={handleLogout} />
}

function AppMain({ userEmail, authEnabled, onLogout }: { userEmail: string | null; authEnabled: boolean; onLogout: () => void }) {
  const [jobs, setJobs] = useState<number[]>([Date.now()])
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickPrompt, setQuickPrompt] = useState('')
  const [quickFamilie, setQuickFamilie] = useState<GenFamilie>(familieVon(STANDARD_MODELL))
  const [quickFamilienModell, setQuickFamilienModell] = useState<Record<GenFamilie, GenModel>>(
    { gpt: STANDARD_MODELL, nano: 'pro' })
  const quickModel = quickFamilienModell[quickFamilie]
  const [quickResolution, setQuickResolution] = useState<'1K' | '2K' | '4K' | 'auto'>('2K')
  const [quickAspectRatio, setQuickAspectRatio] = useState('1:1')
  const [quickOutputFormat, setQuickOutputFormat] = useState<OpenAIFormat>('auto')
  const [quickTransparent, setQuickTransparent] = useState(false)

  const quickRatios = ratiosForModel(quickModel)
  const quickResolutions: Array<'auto' | '1K' | '2K' | '4K'> =
    istGpt(quickModel) ? ['auto', '1K', '2K', '4K'] : ['1K', '2K', '4K']
  const passeQuickAn = (m: GenModel) => {
    if (!ratiosForModel(m).includes(quickAspectRatio)) setQuickAspectRatio('1:1')
    if (!istGpt(m) && quickResolution === 'auto') setQuickResolution('2K')
    if (!kannTransparenz(m)) setQuickTransparent(false)
  }
  const pickQuickFamilie = (f: GenFamilie) => {
    setQuickFamilie(f)
    passeQuickAn(quickFamilienModell[f])
  }
  const setzeQuickModell = (f: GenFamilie, m: GenModel) => {
    setQuickFamilienModell((prev) => ({ ...prev, [f]: m }))
    setQuickFamilie(f)
    passeQuickAn(m)
  }
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
        body: JSON.stringify({
          prompt: quickPrompt.trim(), model: quickModel, resolution: quickResolution, aspectRatio: quickAspectRatio,
          outputFormat: istGpt(quickModel) ? quickOutputFormat : undefined,
          transparent: kannTransparenz(quickModel) && quickTransparent ? true : undefined,
        }),
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
  }, [quickPrompt, quickModel, quickResolution, quickAspectRatio, quickOutputFormat, quickTransparent])

  return (
    <div className="min-h-dvh flex flex-col bg-cream-50">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white border-b border-cream-200">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/heron-mark.svg" alt="" aria-hidden="true" className="w-7 h-7" />
            <div>
              <h1 className="font-display font-bold text-ink-800 text-base leading-none uppercase tracking-[0.1em]">
                Heron
                <span className="text-heron-500 ml-1.5">AI Studio</span>
              </h1>
              <p className="text-ink-400 text-[11px] font-sans mt-0.5">Prompt · Retusche · Bildgenerierung</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setQuickOpen((o) => !o)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-sans font-medium transition-all duration-150 ${quickOpen ? 'bg-heron-500 text-white border-heron-500' : 'bg-white text-ink-500 border-cream-200 hover:border-heron-300 hover:text-heron-600 shadow-card'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Quick Generate
            </button>
            {authEnabled && userEmail && (
              <button onClick={onLogout} title={`Abmelden (${userEmail})`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-white text-ink-400 border-cream-200 hover:border-red-300 hover:text-red-500 shadow-card text-xs font-sans font-medium transition-all duration-150">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="hidden sm:inline">{userEmail.split('@')[0]}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-white border-b border-cream-200">
        <div className="relative z-10 max-w-4xl mx-auto px-5 pt-10 pb-8 text-center">
          <p className="label-step mb-3">AI Creative Studio</p>
          <h2 className="font-display font-bold uppercase text-4xl sm:text-5xl text-ink-800 leading-[1.08] tracking-[0.02em]">
            Prompt. Retuschieren.
            <br />
            <span className="text-heron-500">Bilder generieren.</span>
          </h2>
          <p className="text-ink-400 font-sans text-base mt-4 max-w-lg mx-auto leading-relaxed">
            Referenzbilder hochladen · Lock-Regeln setzen · Claude generiert den Prompt · Gemini oder OpenAI rendert das Bild.
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
                <div className="flex flex-col gap-1">
                  <div className="bg-cream-100 rounded-xl p-0.5 flex gap-0.5">
                    {GEN_FAMILIEN.map((f) => (
                      <button key={f.id} onClick={() => pickQuickFamilie(f.id)}
                        title={`${f.koennen} (${f.preis})`}
                        className={`mode-btn text-xs py-1.5 ${quickFamilie === f.id ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <select value={quickFamilienModell[quickFamilie]}
                    onChange={(e) => setzeQuickModell(quickFamilie, e.target.value as GenModel)}
                    className="w-full bg-cream-100 rounded-lg border-0 text-xs font-sans py-1.5 px-2 text-ink-700
                      cursor-pointer focus:outline-none focus:ring-1 focus:ring-heron-500">
                    {GEN_MODELS.filter((m) => m.familie === quickFamilie).map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <span className="text-[10px] font-sans text-ink-400 leading-snug">
                    {modellDef(quickModel).preis[quickResolution === 'auto' ? '2K' : quickResolution]} je Bild
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="label-section text-[10px]">Auflösung</span>
                <div className="bg-cream-100 rounded-xl p-0.5 flex gap-0.5">
                  {quickResolutions.map((r) => (
                    <button key={r} onClick={() => setQuickResolution(r)}
                      className={`mode-btn text-xs py-1.5 ${quickResolution === r ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                      {r === 'auto' ? 'Auto' : r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="label-section text-[10px]">Format</span>
                <div className="bg-cream-100 rounded-xl p-0.5 flex gap-0.5 flex-wrap">
                  {quickRatios.map((r) => (
                    <button key={r} onClick={() => setQuickAspectRatio(r)}
                      className={`mode-btn text-xs py-1.5 ${quickAspectRatio === r ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                      {r === 'auto' ? 'Auto' : r}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {kannTransparenz(quickModel) && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={quickTransparent}
                  onChange={(e) => setQuickTransparent(e.target.checked)}
                  className="accent-heron-500" />
                <span className="text-[11px] font-sans text-ink-600">
                  Freigestellt ausgeben (transparenter Hintergrund, PNG)
                </span>
              </label>
            )}
            {istGpt(quickModel) && (
              <div className="flex flex-col gap-1">
                <span className="label-section text-[10px]">Output-Format</span>
                <div className="bg-cream-100 rounded-xl p-0.5 flex gap-0.5">
                  {OPENAI_FORMATS.map((f) => (
                    <button key={f} onClick={() => setQuickOutputFormat(f)}
                      className={`mode-btn text-xs py-1.5 ${quickOutputFormat === f ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                      {f === 'auto' ? 'Auto' : f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {quickStatus === 'error' && quickError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-xs animate-scale-in">{quickError}</div>
            )}
            {quickImage && (
              <div className="relative rounded-2xl overflow-hidden bg-cream-100 animate-scale-in">
                <img src={quickImage} alt="Generated" className="w-full object-contain max-h-[500px]" />
                <button
                  onClick={() => { setQuickImage(null); setQuickStatus('idle'); setQuickError(null) }}
                  title="Bild löschen — nächste Generierung startet komplett neu"
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 hover:bg-red-500 hover:text-white text-ink-700 shadow-card backdrop-blur flex items-center justify-center transition-all duration-150 z-10"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
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
          {jobs.map((id) => (
            <div key={id} className={jobs.length > 1 ? 'flex-1 min-w-0' : 'w-full'}>
              <JobPanel
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
          <p className="text-ink-300 text-xs font-sans">Heron AI Studio</p>
          <p className="text-ink-300 text-xs font-sans">Claude Sonnet Vision · {GEN_MODELS.map((m) => m.label).join(' · ')}</p>
        </div>
      </footer>
    </div>
  )
}

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import PromptDisplay from './components/PromptDisplay'
import GeneratedImage from './components/GeneratedImage'
import type { UploadedImage, AnalysisStatus, GenerationStatus, PromptMode, FocusArea, MockupType, GenModel, GenFamilie, OpenAIFormat } from './types'
import { CHANGE_AREAS, MOCKUP_TYPES, GEN_MODELS, GEN_FAMILIEN, OPENAI_FORMATS, ratiosForModel,
  STANDARD_MODELL, istGpt, familieVon, kannTransparenz, modellDef } from './types'
import type { RefRolle, RefBild } from './referenzen'
import { baueLegende, begrenze, setzeManifest } from './referenzen'
import { willGesichtLock, identitaetsKlausel } from './identitaet'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

// ── PDF zu Bildern ───────────────────────────────────────────────────────────
//
// Ein PDF darf NICHT als PDF an das Bildmodell gehen, und es darf auch nicht
// auf die erste Seite eingedampft werden — genau das geschah bisher. Bei einer
// Broschüre sah das Modell also Seite 1 und erfand den Rest; bei einem
// Mockup-Auftrag kam ein Mockup mit ausgedachtem Inhalt heraus.
//
// Jede Seite wird deshalb beim Hochladen einzeln in ein JPEG gerendert und
// wird zu einer eigenen Referenzkarte. Damit sieht das Bildmodell dieselben
// Pixel, die auch in der Druckdatei stehen, und die Nummerierung stimmt auf
// beiden Seiten.

/** Lange Kante der gerenderten Seite. Genug für Text und feine Logos. */
const PDF_ZIELKANTE = 1800

/** Ab diesem Seitenverhältnis kann eine Seite eine Doppelseite sein. */
const DOPPELSEITE_AB = 1.25

async function pdfSeitenZahl(file: File): Promise<number> {
  const daten = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: daten }).promise
  return pdf.numPages
}

/** Eine einzelne Seite rendern. `haelfte` schneidet die linke oder rechte Hälfte heraus. */
async function rendereSeite(
  file: File, seite: number, haelfte?: 'links' | 'rechts',
): Promise<{ datei: File; breite: number; hoehe: number }> {
  const daten = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: daten }).promise
  const page = await pdf.getPage(seite)
  const roh = page.getViewport({ scale: 1 })
  // Auf eine feste lange Kante skalieren statt auf einen festen Faktor: Sonst
  // wird eine A5-Seite winzig und ein Plakat riesig.
  const skala = PDF_ZIELKANTE / Math.max(roh.width, roh.height)
  const viewport = page.getViewport({ scale: Math.min(Math.max(skala, 1), 4) })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')!
  // Weisser Grund: Ein PDF ohne Hintergrund wird sonst schwarz.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport, canvas }).promise

  let ziel = canvas
  if (haelfte) {
    const halb = document.createElement('canvas')
    halb.width = Math.round(canvas.width / 2)
    halb.height = canvas.height
    halb.getContext('2d')!.drawImage(
      canvas, haelfte === 'links' ? 0 : halb.width, 0, halb.width, canvas.height,
      0, 0, halb.width, canvas.height)
    ziel = halb
  }

  const blob = await new Promise<Blob>((fertig) =>
    ziel.toBlob((b) => fertig(b!), 'image/jpeg', 0.92))
  const zusatz = haelfte ? `-${haelfte}` : ''
  const name = `${file.name.replace(/\.pdf$/i, '')}-S${seite}${zusatz}.jpg`
  return { datei: new File([blob], name, { type: 'image/jpeg' }), breite: ziel.width, hoehe: ziel.height }
}

interface PdfSeite {
  datei: File
  breite: number
  hoehe: number
  seite: number
  /** Könnte eine Doppelseite sein — quer und etwa doppelt so breit wie hoch. */
  vielleichtDoppelseite: boolean
  /** Beschriftung für die Karte, z. B. „prospekt.pdf · Titelseite". */
  beschriftung: string
}

/** Höchstzahl gerenderter Seiten. Darüber wird der Auftrag unbezahlbar. */
const PDF_MAX_SEITEN = 12

export async function pdfSeitenAlsBilder(
  file: File, melde?: (text: string, fehler?: boolean) => void,
): Promise<PdfSeite[]> {
  const gesamt = await pdfSeitenZahl(file)
  const anzahl = Math.min(gesamt, PDF_MAX_SEITEN)
  if (gesamt > PDF_MAX_SEITEN) {
    melde?.(`${file.name} hat ${gesamt} Seiten — die ersten ${PDF_MAX_SEITEN} wurden übernommen. `
      + 'Weitere Seiten bei Bedarf einzeln hochladen.', true)
  }
  const seiten: PdfSeite[] = []
  for (let n = 1; n <= anzahl; n++) {
    const { datei, breite, hoehe } = await rendereSeite(file, n)
    const verhaeltnis = breite / hoehe
    seiten.push({
      datei, breite, hoehe, seite: n,
      vielleichtDoppelseite: verhaeltnis >= DOPPELSEITE_AB,
      // Seite 1 ist bei einer Druckdatei fast immer die Titelseite — aber eben
      // nur fast. Deshalb „vermutlich", nicht als Tatsache.
      beschriftung: `${file.name} · ${n === 1 ? 'S.1 (vermutlich Titelseite)' : `S.${n}`}`,
    })
  }
  return seiten
}

/** Eine Doppelseite in zwei Einzelseiten zerlegen. */
export async function teileDoppelseite(
  quelle: File, seite: number, dateiName: string,
): Promise<Array<{ datei: File; breite: number; hoehe: number; beschriftung: string }>> {
  const ergebnis = []
  for (const haelfte of ['links', 'rechts'] as const) {
    const { datei, breite, hoehe } = await rendereSeite(quelle, seite, haelfte)
    ergebnis.push({
      datei, breite, hoehe,
      beschriftung: `${dateiName} · S.${seite} ${haelfte}`,
    })
  }
  return ergebnis
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

/**
 * Der Stand eines Auftrags, so wie er an ein Duplikat weitergereicht wird.
 * Absichtlich lose typisiert: Sonst müsste jedes neue Feld im Panel an drei
 * Stellen nachgetragen werden, und beim Vergessen fiele es niemandem auf.
 */
type JobVorlage = Record<string, unknown>

/** Wert aus der Vorlage, sonst der Standard. Der Typ kommt vom Standard. */
function ausVorlage<T>(v: JobVorlage | undefined, feld: string, standard: T): T {
  return v && feld in v ? (v[feld] as T) : standard
}

/**
 * Bilder für ein Duplikat neu anlegen. Die Datei selbst ist unveränderlich und
 * darf geteilt werden, die Vorschau-Adresse nicht: Wird sie im einen Auftrag
 * freigegeben, wäre das Bild im anderen kaputt.
 */
function kopiereBilder(liste: UploadedImage[]): UploadedImage[] {
  return liste.map((b) => ({
    ...b,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    preview: URL.createObjectURL(b.file),
  }))
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
  img, index, onRemove, onUpdate, onTeilen, disabled,
}: {
  img: UploadedImage; index: number; onRemove: () => void
  onUpdate: (field: 'faceLock' | 'objectLock' | 'customLock' | 'rolle', value: boolean | string) => void
  /** Nur bei PDF-Seiten, die eine Doppelseite sein könnten. */
  onTeilen?: () => void
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
          {/* Eine Doppelseite aus einer Druckdatei lässt sich nicht sicher von
              einer echten Querformat-Seite unterscheiden — A4 quer und zwei
              A4 hoch nebeneinander haben dasselbe Seitenverhältnis. Deshalb
              wird hier nur gefragt, nicht automatisch geteilt. */}
          {img.vielleichtDoppelseite && onTeilen && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-sans text-heron-700">
                Sieht nach einer Doppelseite aus.
              </span>
              <button type="button" onClick={onTeilen} disabled={disabled}
                title="In linke und rechte Einzelseite zerlegen"
                className="px-2 py-1 text-[10px] font-sans font-medium border border-heron-500 text-heron-600 hover:bg-heron-500 hover:text-white transition-colors">
                In zwei Seiten teilen
              </button>
            </div>
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

// ── Spracheingabe ────────────────────────────────────────────────────────────
//
// Diktieren statt tippen. Die Web-Speech-Schnittstelle gibt es nicht überall —
// in Safari und Firefox fehlt sie ganz. Statt einer Schaltfläche, die nichts
// tut, erscheint sie dort erst gar nicht.
//
// Erkannte Sätze werden ANGEHÄNGT, nicht ersetzt: Wer schon etwas getippt hat
// und dann diktiert, verlöre sonst seinen Text.

interface SpracheErgebnis { transcript: string }
interface SpracheAlternative { 0: SpracheErgebnis; isFinal: boolean; length: number }
interface SpracheEvent { resultIndex: number; results: { length: number; [i: number]: SpracheAlternative } }
interface Spracherkenner {
  lang: string; continuous: boolean; interimResults: boolean
  start(): void; stop(): void
  onresult: ((e: SpracheEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

function erkennerBauen(): Spracherkenner | null {
  const w = window as unknown as { SpeechRecognition?: new () => Spracherkenner; webkitSpeechRecognition?: new () => Spracherkenner }
  const Klasse = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Klasse ? new Klasse() : null
}

function Spracheingabe({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const erkennerRef = useRef<Spracherkenner | null>(null)
  const [moeglich] = useState(() => erkennerBauen() !== null)

  // Beim Verlassen abschalten, sonst hört das Mikrofon weiter zu.
  useEffect(() => () => { erkennerRef.current?.stop() }, [])

  if (!moeglich) return null

  const umschalten = () => {
    if (laeuft) {
      erkennerRef.current?.stop()
      return
    }
    const e = erkennerBauen()
    if (!e) return
    e.lang = 'de-DE'
    e.continuous = true
    e.interimResults = false
    e.onresult = (ev) => {
      let neu = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) neu += ev.results[i][0].transcript
      }
      if (neu.trim()) onText(neu.trim())
    }
    e.onerror = (ev) => {
      setFehler(ev.error === 'not-allowed'
        ? 'Kein Zugriff aufs Mikrofon — im Browser erlauben.'
        : `Spracheingabe: ${ev.error}`)
      setLaeuft(false)
    }
    e.onend = () => setLaeuft(false)
    erkennerRef.current = e
    setFehler(null)
    e.start()
    setLaeuft(true)
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={umschalten} disabled={disabled}
        title={laeuft ? 'Aufnahme beenden' : 'Diktieren — der erkannte Text wird angehängt'}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-sans font-medium border transition-colors duration-150
          ${laeuft ? 'border-red-500 bg-red-500 text-white' : 'border-cream-300 bg-white text-ink-500 hover:border-heron-500 hover:text-heron-600'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <svg className={`w-3.5 h-3.5 ${laeuft ? 'animate-pulse-soft' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 11a7 7 0 01-14 0m7 7v3m0-3a4 4 0 004-4V6a4 4 0 10-8 0v5a4 4 0 004 4z" />
        </svg>
        {laeuft ? 'Hört zu…' : 'Diktieren'}
      </button>
      {fehler && <span className="text-[10px] font-sans text-red-600">{fehler}</span>}
    </div>
  )
}

// ── Upload Zone ───────────────────────────────────────────────────────────────
//
// Es gibt zwei davon: Ausgangsmaterial und Zielreferenz. Die Trennung ist keine
// Kosmetik — sie entscheidet, was das Bildmodell aus einem Bild übernehmen darf
// (Inhalt und Gesicht) und was nur seine Anmutung beisteuert. Vorher musste die
// Rolle an jeder Karte einzeln gesetzt werden, und wer das vergaß, bekam die
// Person aus dem falschen Bild.
function UploadZone({
  images, rolle, nummerVon, titel, hinweis, breit, aktiv, onAktiv,
  onAdd, onRemove, onClear, onUpdateImage, onTeilen, disabled,
}: {
  images: UploadedImage[]
  rolle: RefRolle
  /**
   * Die Nummer, unter der ein Bild beim Bildmodell erscheint. Zählte jede
   * Fläche für sich, stünde auf der Karte „1", während im Prompt „IMAGE 3"
   * gemeint ist — und niemand sähe den Fehler.
   */
  nummerVon: (img: UploadedImage) => number
  titel: string
  hinweis: string
  /** Die breite Fläche bekommt mehr Höhe und einen ausführlicheren Text. */
  breit?: boolean
  /** Landet ein Cmd+V gerade in dieser Fläche? */
  aktiv?: boolean
  onAktiv?: () => void
  onAdd: (files: FileList | File[], rolle: RefRolle) => void
  onRemove: (id: string) => void; onClear: () => void
  onUpdateImage: (id: string, field: 'faceLock' | 'objectLock' | 'customLock' | 'rolle', value: boolean | string) => void
  onTeilen: (id: string) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    if (!disabled) onAdd(e.dataTransfer.files, rolle)
  }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); if (!disabled) setDragging(true) }
  const handleDragLeave = () => setDragging(false)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-section">{titel}</span>
        {aktiv && (
          <span className="text-[10px] font-sans text-heron-600 whitespace-nowrap">⌘V landet hier</span>
        )}
      </div>
      <div onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
        onMouseEnter={onAktiv}
        onClick={() => { onAktiv?.(); if (!disabled) inputRef.current?.click() }}
        className={`relative flex flex-col items-center justify-center gap-3 border-2 border-dashed cursor-pointer select-none transition-all duration-200
          ${images.length > 0 ? 'p-4' : (breit ? 'p-8' : 'p-6')}
          ${dragging ? 'drop-zone-active' : aktiv
            ? 'border-heron-400 bg-heron-50/60'
            : 'border-cream-300 bg-cream-50 hover:border-heron-300 hover:bg-heron-50/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
          onChange={(e) => { if (e.target.files) onAdd(e.target.files, rolle); e.target.value = '' }} disabled={disabled} />
        {images.length === 0 ? (
          <>
            <div className={`w-12 h-12 flex items-center justify-center transition-all duration-200 ${dragging ? 'bg-heron-100' : 'bg-white border border-cream-200'}`}>
              <svg className={`w-6 h-6 transition-colors duration-200 ${dragging ? 'text-heron-500' : 'text-ink-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-sans font-medium text-ink-700 text-sm">
                {dragging ? 'Jetzt loslassen' : 'Ablegen, einfügen oder durchsuchen'}
              </p>
              <p className="text-ink-400 text-xs mt-1 font-sans leading-snug">{hinweis}</p>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-ink-400 text-xs font-sans text-center">
            <svg className="w-4 h-4 text-heron-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Weiteres Bild
          </div>
        )}
      </div>
      {images.length > 0 && (
        <div className="flex flex-col gap-2 animate-slide-up">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-sans text-ink-400">
              {images.length} Bild{images.length !== 1 ? 'er' : ''}
            </span>
            <button onClick={onClear} disabled={disabled}
              className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-600 hover:bg-red-50">
              Alle entfernen
            </button>
          </div>
          {images.map((img) => (
            <ImageCard key={img.id} img={img} index={nummerVon(img) - 1}
              onRemove={() => onRemove(img.id)}
              onUpdate={(field, value) => onUpdateImage(img.id, field, value)}
              onTeilen={() => onTeilen(img.id)}
              disabled={disabled} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Job Panel (self-contained per-job state + UI) ─────────────────────────────
function JobPanel({
  vorlage,
  onAbzug,
}: {
  /** Stand eines anderen Auftrags, von dem dieser hier abgezogen wurde. */
  vorlage?: JobVorlage
  /** Meldet dem Elternteil, wie sich der aktuelle Stand abfragen lässt. */
  onAbzug?: (lies: () => JobVorlage) => void
}) {
  const v = vorlage
  const [images, setImages] = useState<UploadedImage[]>(
    () => v ? kopiereBilder(ausVorlage<UploadedImage[]>(v, 'images', [])) : [])
  const [userDescription, setUserDescription] = useState(() => ausVorlage(v, 'userDescription', ''))
  const [promptMode, setPromptMode] = useState<PromptMode>(() => ausVorlage<PromptMode>(v, 'promptMode', 'retouch'))
  const [changeAreas, setChangeAreas] = useState<FocusArea[]>(() => ausVorlage<FocusArea[]>(v, 'changeAreas', []))
  const [mockupType, setMockupType] = useState<MockupType | ''>(() => ausVorlage<MockupType | ''>(v, 'mockupType', ''))
  const [mockupEnvironment, setMockupEnvironment] = useState<'light' | 'dark' | ''>(
    () => ausVorlage<'light' | 'dark' | ''>(v, 'mockupEnvironment', ''))
  const [prompt, setPrompt] = useState(() => ausVorlage(v, 'prompt', ''))
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle')
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  /** Woran das Modell gerade arbeitet — nur Anzeige, nie Teil des Prompts. */
  const [denkSchritt, setDenkSchritt] = useState('')
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
  // Mehrere Familien gleichzeitig: Dann rechnet jedes gewählte Modell denselben
  // Auftrag, und man sieht nebeneinander, wer die Aufgabe besser löst.
  const [aktiveFamilien, setAktiveFamilien] = useState<GenFamilie[]>(
    () => ausVorlage<GenFamilie[]>(v, 'aktiveFamilien', [familieVon(STANDARD_MODELL)]))
  const [familienModell, setFamilienModell] = useState<Record<GenFamilie, GenModel>>(
    () => ausVorlage<Record<GenFamilie, GenModel>>(v, 'familienModell', { gpt: STANDARD_MODELL, nano: 'pro' }))
  // Reihenfolge kommt aus GEN_FAMILIEN, damit GPT Image immer zuerst rechnet.
  const aktiveModelle = useMemo(
    () => GEN_FAMILIEN.filter((f) => aktiveFamilien.includes(f.id)).map((f) => familienModell[f.id]),
    [aktiveFamilien, familienModell])
  /** Für Beschriftungen und Einzelangaben: das erste gewählte Modell. */
  const selectedModel = aktiveModelle[0] ?? STANDARD_MODELL
  const [selectedResolution, setSelectedResolution] = useState<'1K' | '2K' | '4K' | 'auto'>(
    () => ausVorlage<'1K' | '2K' | '4K' | 'auto'>(v, 'selectedResolution', '2K'))
  const [selectedAspectRatio, setSelectedAspectRatio] = useState(() => ausVorlage(v, 'selectedAspectRatio', '1:1'))
  const [selectedOutputFormat, setSelectedOutputFormat] = useState<OpenAIFormat>(
    () => ausVorlage<OpenAIFormat>(v, 'selectedOutputFormat', 'auto'))
  // Freistellen können nur die gpt-image-2.5-Modelle. Der Schalter verschwindet
  // bei allen anderen, statt still wirkungslos zu bleiben.
  const [transparent, setTransparent] = useState(() => ausVorlage(v, 'transparent', false))
  // Mehrere Bilder aus demselben Prompt, zum Auswählen. Bildmodelle sind nicht
  // deterministisch — der zweite Anlauf ist oft der bessere, und nebeneinander
  // sieht man das sofort.
  const [variantCount, setVariantCount] = useState<1 | 2 | 3>(() => ausVorlage<1 | 2 | 3>(v, 'variantCount', 1))
  const [genResults, setGenResults] = useState<Array<{ label: string; image: string }>>([])
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null)

  // Nur was JEDES gewählte Modell kann, darf angeboten werden. Ein Format, das
  // eines davon nicht kennt, liesse den Auftrag sonst mittendrin scheitern.
  const availableRatios = useMemo(
    () => aktiveModelle
      .map(ratiosForModel)
      .reduce((a, b) => a.filter((r) => b.includes(r)), ratiosForModel(selectedModel)),
    [aktiveModelle, selectedModel])
  const alleGpt = aktiveModelle.every(istGpt)
  const alleTransparenz = aktiveModelle.length > 0 && aktiveModelle.every(kannTransparenz)
  const availableResolutions: Array<'auto' | '1K' | '2K' | '4K'> =
    alleGpt ? ['auto', '1K', '2K', '4K'] : ['1K', '2K', '4K']

  /** Einstellungen an eine Modellauswahl anpassen, die sie vielleicht nicht kennt. */
  const passeEinstellungenAn = (modelle: GenModel[]) => {
    if (modelle.length === 0) return
    const gemeinsam = modelle
      .map(ratiosForModel)
      .reduce((a, b) => a.filter((r) => b.includes(r)), ratiosForModel(modelle[0]))
    if (!gemeinsam.includes(selectedAspectRatio)) setSelectedAspectRatio('1:1')
    if (!modelle.every(istGpt) && selectedResolution === 'auto') setSelectedResolution('2K')
    if (!modelle.every(kannTransparenz)) setTransparent(false)
  }

  // Familie an- und abwählen. Die letzte bleibt stehen — ohne Modell geht nichts.
  const toggleFamilie = (f: GenFamilie) => {
    setAktiveFamilien((prev) => {
      const neu = prev.includes(f)
        ? (prev.length > 1 ? prev.filter((x) => x !== f) : prev)
        : [...prev, f]
      passeEinstellungenAn(GEN_FAMILIEN.filter((x) => neu.includes(x.id)).map((x) => familienModell[x.id]))
      return neu
    })
  }

  // Wer im Dropdown etwas aussucht, will damit rechnen — also Familie mit anhaken.
  const setzeModell = (f: GenFamilie, m: GenModel) => {
    const naechste = { ...familienModell, [f]: m }
    setFamilienModell(naechste)
    setAktiveFamilien((prev) => {
      const neu = prev.includes(f) ? prev : [...prev, f]
      passeEinstellungenAn(GEN_FAMILIEN.filter((x) => neu.includes(x.id)).map((x) => naechste[x.id]))
      return neu
    })
  }

  // Kurze Rückmeldung am Kopf des Panels (Einfügen, PDF-Fehler). Steht hier
  // oben, weil sie schon beim Hochladen gebraucht wird.
  const wurzelRef = useRef<HTMLDivElement>(null)
  const [eingefuegt, setEingefuegt] = useState<{ text: string; fehler?: boolean } | null>(null)
  const melde = useCallback((text: string, fehler = false) => {
    setEingefuegt({ text, fehler })
    window.setTimeout(() => setEingefuegt(null), 3000)
  }, [])

  const addImages = useCallback((files: FileList | File[], rolle: RefRolle = 'ausgang') => {
    const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf'])
    const accepted = Array.from(files).filter((f) => {
      if (f.type.startsWith('image/') || f.type === 'application/pdf') return true
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return IMAGE_EXTS.has(ext)
    })
    const pdfs = accepted.filter((f) => f.type === 'application/pdf')
    const bilder = accepted.filter((f) => f.type !== 'application/pdf')

    const neue = bilder.map((f) => ({ ...createUploadedImage(f), rolle }))
    if (neue.length > 0) setImages((prev) => [...prev, ...neue])
    // Maße nachtragen, sobald sie bekannt sind — für den Auflösungshinweis.
    for (const eintrag of neue) {
      const messbild = new Image()
      messbild.onload = () => setImages((prev) => prev.map((i) =>
        i.id === eintrag.id ? { ...i, breite: messbild.width, hoehe: messbild.height } : i))
      messbild.src = eintrag.preview
    }

    // Jede PDF-Seite wird eine eigene Karte. Vorher ging das PDF als PDF an den
    // Prompt-Schreiber und bei der Generierung nur seine ERSTE Seite ans
    // Bildmodell — der Rest wurde erfunden.
    for (const pdf of pdfs) {
      setPdfLaeuft((v) => v + 1)
      void pdfSeitenAlsBilder(pdf, melde)
        .then((seiten) => {
          setImages((prev) => [...prev, ...seiten.map((s) => ({
            ...createUploadedImage(s.datei),
            rolle,
            name: s.beschriftung,
            breite: s.breite,
            hoehe: s.hoehe,
            pdfQuelle: pdf,
            pdfSeite: s.seite,
            vielleichtDoppelseite: s.vielleichtDoppelseite,
          }))])
        })
        .catch((e) => melde(`PDF konnte nicht gelesen werden: ${e instanceof Error ? e.message : 'Fehler'}`, true))
        .finally(() => setPdfLaeuft((v) => v - 1))
    }
  }, [melde])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => { const img = prev.find((i) => i.id === id); if (img) URL.revokeObjectURL(img.preview); return prev.filter((i) => i.id !== id) })
  }, [])

  const clearRolle = useCallback((rolle: RefRolle) => {
    setImages((prev) => {
      prev.filter((i) => i.rolle === rolle).forEach((i) => URL.revokeObjectURL(i.preview))
      return prev.filter((i) => i.rolle !== rolle)
    })
  }, [])

  /** Wie viele PDFs werden gerade gerendert? */
  const [pdfLaeuft, setPdfLaeuft] = useState(0)

  /** Eine Doppelseite in zwei Einzelseiten zerlegen. */
  const doppelseiteTeilen = useCallback(async (id: string) => {
    const karte = images.find((i) => i.id === id)
    if (!karte?.pdfQuelle || !karte.pdfSeite) return
    setPdfLaeuft((v) => v + 1)
    try {
      const haelften = await teileDoppelseite(karte.pdfQuelle, karte.pdfSeite, karte.pdfQuelle.name)
      setImages((prev) => {
        const i = prev.findIndex((x) => x.id === id)
        if (i === -1) return prev
        URL.revokeObjectURL(prev[i].preview)
        const neue = haelften.map((h) => ({
          ...createUploadedImage(h.datei),
          rolle: karte.rolle,
          name: h.beschriftung,
          breite: h.breite,
          hoehe: h.hoehe,
          pdfQuelle: karte.pdfQuelle,
          pdfSeite: karte.pdfSeite,
          vielleichtDoppelseite: false,
        }))
        // An dieselbe Stelle setzen, damit die Reihenfolge der Seiten bleibt.
        return [...prev.slice(0, i), ...neue, ...prev.slice(i + 1)]
      })
    } catch (e) {
      melde(`Doppelseite konnte nicht geteilt werden: ${e instanceof Error ? e.message : 'Fehler'}`, true)
    } finally {
      setPdfLaeuft((v) => v - 1)
    }
  }, [images, melde])

  /** Welche Fläche bekommt das nächste Cmd+V? */
  const [einfuegeZiel, setEinfuegeZiel] = useState<RefRolle>('ausgang')
  const ausgangsBilder = useMemo(() => images.filter((i) => i.rolle !== 'ziel'), [images])
  const zielBilder = useMemo(() => images.filter((i) => i.rolle === 'ziel'), [images])

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
  // ── Einfügen aus der Zwischenablage ─────────────────────────────────────
  //
  // Der Horcher hängt am Fenster, weil ein kopiertes Bild eingefügt wird, ohne
  // dass vorher irgendwo geklickt wurde — es gibt also kein Element mit Fokus.
  // Bei mehreren Reitern reagiert nur der sichtbare: offsetParent ist bei
  // ausgeblendeten Panels null.

  /**
   * Adresse eines Bildes einfügen. Der Browser darf ein fremdes Bild wegen CORS
   * meist nicht selbst laden, deshalb holt es der Server.
   */
  const holeVonAdresse = useCallback(async (url: string, rolle: RefRolle) => {
    melde('Bild wird geholt…')
    try {
      const res = await fetch('/api/bild-holen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ url }),
      })
      const daten = await res.json()
      if (!res.ok) throw new Error(daten.error || 'Bild konnte nicht geholt werden')
      const bytes = Uint8Array.from(atob(daten.data), (c) => c.charCodeAt(0))
      const datei = new File([bytes], daten.name || 'eingefuegt', { type: daten.mimeType })
      addImages([datei], rolle)
      melde(`Bild eingefügt — ${rolle === 'ziel' ? 'Zielreferenz' : 'Ausgangsmaterial'}`)
    } catch (e) {
      melde(e instanceof Error ? e.message : 'Bild konnte nicht geholt werden', true)
    }
  }, [addImages, melde])

  const zielRef = useRef<RefRolle>('ausgang')
  zielRef.current = einfuegeZiel

  useEffect(() => {
    const beiEinfuegen = (e: ClipboardEvent) => {
      if (!wurzelRef.current || wurzelRef.current.offsetParent === null) return
      const ziel = e.target as HTMLElement | null
      const dateien = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      // In einem Textfeld gilt das Einfügen dem Text — ausser es liegt
      // tatsächlich ein Bild in der Zwischenablage.
      if (ziel && /^(INPUT|TEXTAREA)$/.test(ziel.tagName) && dateien.length === 0) return

      const wohin = zielRef.current
      if (dateien.length > 0) {
        e.preventDefault()
        addImages(dateien, wohin)
        melde(`${dateien.length} Bild${dateien.length !== 1 ? 'er' : ''} eingefügt — ${wohin === 'ziel' ? 'Zielreferenz' : 'Ausgangsmaterial'}`)
        return
      }

      // Kein Bild, aber vielleicht ein Verweis darauf: Wer auf einer Webseite
      // einen Ausschnitt markiert und kopiert, hat nur HTML mit einem <img> in
      // der Zwischenablage — genau der Fall beim Kopieren aus der Google-Suche.
      const html = e.clipboardData?.getData('text/html') ?? ''
      const text = (e.clipboardData?.getData('text/plain') ?? '').trim()
      const ausHtml = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
      const adresse = ausHtml
        ?? (/^https?:\/\//i.test(text) ? text : undefined)
      if (!adresse) return
      e.preventDefault()
      void holeVonAdresse(adresse, wohin)
    }
    window.addEventListener('paste', beiEinfuegen)
    return () => window.removeEventListener('paste', beiEinfuegen)
  }, [addImages, holeVonAdresse, melde])

  /** Die Nummer eines Bildes in der verbindlichen Reihenfolge, 1-basiert. */
  const nummerVon = useCallback(
    (img: UploadedImage) => geordneteBilder.findIndex((b) => b.id === img.id) + 1,
    [geordneteBilder])

  /** Bildnummern (1-basiert) je Rolle — für die Identitätsklausel. */
  const nummernMit = (rolle: RefRolle) => geordneteBilder
    .map((b, i) => ({ b, nr: i + 1 })).filter((x) => x.b.rolle === rolle).map((x) => x.nr)

  const toggleChange = useCallback((area: FocusArea) =>
    setChangeAreas((p) => p.includes(area) ? p.filter((a) => a !== area) : [...p, area]), [])

  const handleAnalyze = useCallback(async () => {
    if (images.length === 0 && promptMode !== 'generation') return
    setAnalysisStatus('analyzing'); setAnalysisError(null); setPrompt(''); setDenkSchritt('')
    try {
      // PDFs gibt es hier nicht mehr — sie wurden beim Hochladen in einzelne
      // Seitenbilder zerlegt. Prompt-Schreiber und Bildmodell sehen dadurch
      // exakt dasselbe.
      const compressed = await Promise.all(geordneteBilder.map((img) => compressImage(img.file)))
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
      let denken = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'text') { accumulated += data.text; setPrompt(accumulated) }
            // Der Denkteil gehört NICHT in den Prompt — nur in die Anzeige,
            // damit man sieht, dass etwas vorangeht.
            else if (data.type === 'denken') {
              denken += data.text
              const saetze = denken.split(/(?<=[.!?])\s+/).filter(Boolean)
              setDenkSchritt(saetze[saetze.length - 1]?.slice(0, 160) ?? '')
            }
            else if (data.type === 'error') throw new Error(data.error)
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
          }
        }
      }
      setAnalysisStatus('done')
      setDenkSchritt('')
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Analyse fehlgeschlagen')
      setAnalysisStatus('error')
      setDenkSchritt('')
    }
  }, [geordneteBilder, userDescription, promptMode, changeAreas, mockupType, mockupEnvironment])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return
    setGenerationStatus('generating'); setGenerationError(null); setGeneratedImage(null)
    // Jede Variante läuft auf jedem gewählten Modell. Nach Variante gruppiert,
    // damit früh je ein Ergebnis pro Modell dasteht.
    const laeufe = Array.from({ length: variantCount }, (_, i) => i + 1)
      .flatMap((v) => aktiveModelle.map((model) => ({ v, model })))
    setGenResults([]); setGenProgress({ done: 0, total: laeufe.length })
    try {
      const bilder = begrenze(geordneteBilder)
      const referenceImages = await Promise.all(
        bilder.map((img) => compressImage(img.file).then(
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
      // Der Prompt-Schreiber kennt die endgültige Reihenfolge nicht sicher —
      // er sieht die Bilder, aber die Liste wird hier gebildet. Deshalb wird
      // der Block `reference_images` deterministisch gesetzt statt ihm
      // überlassen: Sonst stehen am Ende zwei Listen im JSON, die sich
      // widersprechen. Ist der Prompt kein JSON (etwa von Hand überschrieben),
      // bleibt er unverändert.
      const mitManifest = setzeManifest(prompt, rollenListe)
      const volltext = [legende, mitManifest, klausel].filter(Boolean).join('\n\n')

      // Nacheinander statt parallel: So steht das erste Bild sofort da, jeder
      // einzelne Aufruf bleibt im Zeitlimit der Vercel-Function, und wir laufen
      // nicht in die Mengenbegrenzung der Anbieter.
      const fertig: Array<{ label: string; image: string }> = []
      const fehler: string[] = []
      for (const lauf of laeufe) {
        // Die Beschriftung nennt nur, was sich zwischen den Läufen unterscheidet.
        const teile: string[] = []
        if (variantCount > 1) teile.push(`Variante ${lauf.v}`)
        if (aktiveModelle.length > 1) teile.push(modellDef(lauf.model).label)
        const name = teile.join(' · ') || 'Ergebnis'
        try {
          const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: volltext, model: lauf.model, resolution: selectedResolution, aspectRatio: selectedAspectRatio,
              outputFormat: istGpt(lauf.model) ? selectedOutputFormat : undefined,
              transparent: kannTransparenz(lauf.model) && transparent ? true : undefined,
              referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
            }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }))
            throw new Error(err.error || `Server error: ${res.status}`)
          }
          const data = await res.json()
          fertig.push({ label: name, image: data.image })
          setGenResults([...fertig])
          // Das erste fertige Bild wird gleich das aktive, damit man nicht auf
          // die ganze Serie warten muss.
          if (fertig.length === 1) { setGeneratedImage(data.image); setGeneratedModel(data.model) }
        } catch (e) {
          fehler.push(`${name}: ${e instanceof Error ? e.message : 'Fehler'}`)
        }
        setGenProgress({ done: fertig.length + fehler.length, total: laeufe.length })
      }
      if (fertig.length === 0) throw new Error(fehler.join(' · ') || 'Generierung fehlgeschlagen')
      // Teilerfolg ist kein Fehlschlag: Die fertigen Bilder bleiben stehen, der
      // Rest wird benannt.
      setGenerationError(fehler.length > 0 ? `${fehler.length} von ${laeufe.length} fehlgeschlagen — ${fehler.join(' · ')}` : null)
      setGenerationStatus('done')
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Generierung fehlgeschlagen')
      setGenerationStatus('error')
    } finally {
      setGenProgress(null)
    }
  }, [prompt, aktiveModelle, selectedResolution, selectedAspectRatio, selectedOutputFormat,
      transparent, variantCount, geordneteBilder])

  // Dem Elternteil einen Lesezugriff auf den aktuellen Stand geben. Nur so
  // lässt sich ein Auftrag duplizieren, ohne den gesamten Zustand nach oben zu
  // ziehen. Bewusst OHNE Ergebnisse — ein Duplikat startet mit leerer Ausgabe,
  // sonst sähe es aus, als wäre schon etwas gerechnet worden.
  const standRef = useRef<() => JobVorlage>(() => ({}))
  standRef.current = () => ({
    images, userDescription, promptMode, changeAreas, mockupType, mockupEnvironment, prompt,
    aktiveFamilien, familienModell, selectedResolution, selectedAspectRatio, selectedOutputFormat,
    transparent, variantCount,
  })
  useEffect(() => { onAbzug?.(() => standRef.current()) }, [onAbzug])

  const canAnalyze = (images.length > 0 || promptMode === 'generation') && analysisStatus !== 'analyzing'
  const canGenerate = prompt.trim().length > 0 && generationStatus !== 'generating'

  return (
    <div className="flex flex-col gap-5" ref={wurzelRef}>

      {pdfLaeuft > 0 && (
        <div className="px-3 py-2 text-xs font-sans border border-heron-200 bg-heron-50 text-heron-700 animate-fade-in">
          PDF wird in einzelne Seiten zerlegt…
        </div>
      )}

      {eingefuegt && (
        <div className={`px-3 py-2 text-xs font-sans animate-fade-in border
          ${eingefuegt.fehler ? 'border-red-200 bg-red-50 text-red-700' : 'border-heron-200 bg-heron-50 text-heron-700'}`}>
          {eingefuegt.text}
        </div>
      )}

      {/* Upload Zone */}
      {promptMode === 'generation' && images.length === 0 && (
        <p className="text-center text-xs font-sans text-ink-400">
          <span className="text-heron-600 font-medium">Optional:</span> Stil-Referenzbilder hochladen — oder einfach unten beschreiben.
        </p>
      )}
      {/* Zwei Drittel Ausgangsmaterial, ein Drittel Zielreferenz: Der Inhalt
          kommt aus dem Ausgangsmaterial, dort liegen in aller Regel auch mehr
          Bilder. Die Zielreferenz steuert nur Anmutung bei und braucht selten
          mehr als ein Bild. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
        <div className="sm:col-span-2 flex flex-col gap-3">
          <UploadZone
            images={ausgangsBilder} rolle="ausgang" breit nummerVon={nummerVon}
            titel="Ausgangsmaterial"
            hinweis="Woraus etwas entsteht — wird originalgetreu übernommen, samt Gesicht. JPEG, PNG, WebP, PDF."
            aktiv={einfuegeZiel === 'ausgang'} onAktiv={() => setEinfuegeZiel('ausgang')}
            onAdd={addImages} onRemove={removeImage} onClear={() => clearRolle('ausgang')}
            onUpdateImage={updateImageSetting} onTeilen={doppelseiteTeilen}
            disabled={analysisStatus === 'analyzing'} />
        </div>
        <div className="flex flex-col gap-3">
          <UploadZone
            images={zielBilder} rolle="ziel" nummerVon={nummerVon}
            titel="Zielreferenz"
            hinweis="Wie das Ergebnis aussehen soll: Farbe, Licht, Perspektive, Ausschnitt — nicht die Objekte oder Personen daraus."
            aktiv={einfuegeZiel === 'ziel'} onAktiv={() => setEinfuegeZiel('ziel')}
            onAdd={addImages} onRemove={removeImage} onClear={() => clearRolle('ziel')}
            onUpdateImage={updateImageSetting} onTeilen={doppelseiteTeilen}
            disabled={analysisStatus === 'analyzing'} />
        </div>
      </div>

      {/* Mode Toggle + Settings */}
      <div className="card p-5 flex flex-col gap-5">

        <div className="flex flex-col gap-2">
          <span className="label-section">Modus</span>
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
          <div className="flex items-center justify-between gap-2">
            <span className="label-section">Was möchtest du machen?</span>
            <Spracheingabe disabled={analysisStatus === 'analyzing'}
              onText={(t) => setUserDescription((alt) => (alt.trim() ? `${alt.trim()} ${t}` : t))} />
          </div>
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

        {analysisStatus === 'analyzing' && denkSchritt && (
          <p className="text-[11px] font-sans text-ink-400 leading-snug px-1 animate-fade-in">
            {denkSchritt}
          </p>
        )}

        {analysisStatus === 'error' && analysisError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 animate-scale-in">
            <p className="text-red-700 text-sm font-sans font-medium">Fehler beim Analysieren</p>
            <p className="text-red-500 text-xs mt-1 font-sans leading-relaxed">{analysisError}</p>
          </div>
        )}

        <div className="bg-heron-50 border border-heron-200 rounded-xl px-4 py-3">
          <p className="text-ink-500 text-xs font-sans leading-relaxed">
            Die Referenzbilder werden mit ihren Rollen und Lock-Regeln analysiert; daraus entsteht ein strukturierter Prompt als JSON.
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
              setGenResults([])
            }} />

          {/* Fortschritt über die Serie. Ohne ihn sieht es bei drei Varianten
              aus, als hinge das Werkzeug. */}
          {genProgress && genProgress.total > 1 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-cream-200">
                <div className="h-full bg-heron-500 transition-all duration-300"
                  style={{ width: `${(genProgress.done / genProgress.total) * 100}%` }} />
              </div>
              <span className="text-[11px] font-sans text-ink-400 tabular-nums">
                {genProgress.done}/{genProgress.total}
              </span>
            </div>
          )}

          {/* Die Serie zum Auswählen. Ein Klick macht ein Bild zum aktiven —
              alles Weitere (Herunterladen, Weiterverarbeiten) bezieht sich
              dann darauf. */}
          {genResults.length > 1 && (
            <div className="flex flex-col gap-2 animate-fade-in">
              <span className="label-section">Ergebnisse ({genResults.length})</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {genResults.map((r, i) => (
                  <div key={`${r.label}-${i}`} className="group relative overflow-hidden border border-cream-200 bg-cream-100">
                    <button onClick={() => setGeneratedImage(r.image)} className="block w-full"
                      title={`${r.label} als aktives Bild setzen`}>
                      <img src={r.image} alt={r.label} className="w-full aspect-square object-cover" />
                    </button>
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-ink-900/70 px-2 py-1.5">
                      <span className="text-white text-[11px] font-sans truncate">{r.label}</span>
                      <a href={r.image} download={`heron-${r.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.png`}
                        title="Herunterladen"
                        className="shrink-0 text-white/80 hover:text-white transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </a>
                    </div>
                    {generatedImage === r.image && (
                      <div className="absolute inset-0 ring-2 ring-heron-500 pointer-events-none" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="label-section">Modell</span>
              {/* Ein Schalter je Anbieter, darunter die Modellwahl. Der Hover
                  erklärt Stärken und ungefähre Kosten — die Modellnamen allein
                  sagen niemandem, was er bestellt. Auf dem Telefon gibt es kein
                  Hover, deshalb steht dasselbe noch einmal unter dem Dropdown. */}
              <div className="grid grid-cols-2 gap-2">
                {GEN_FAMILIEN.map((f) => {
                  const aktiv = aktiveFamilien.includes(f.id)
                  const modelle = GEN_MODELS.filter((m) => m.familie === f.id)
                  const gewaehlt = modellDef(familienModell[f.id])
                  return (
                    <div key={f.id} className="flex flex-col gap-1">
                      <div className="relative group">
                        <button onClick={() => toggleFamilie(f.id)}
                          aria-pressed={aktiv}
                          title={aktiv
                            ? (aktiveFamilien.length > 1 ? 'Abwählen' : 'Mindestens ein Modell muss gewählt bleiben')
                            : 'Zusätzlich mit diesem Modell rechnen'}
                          className={`mode-btn w-full !flex-col gap-0.5 text-xs py-2.5 leading-tight text-center
                            ${aktiv ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                          <span className="flex items-center gap-1.5 text-sm">
                            {/* Ein Haken, damit sichtbar ist: Das lässt sich mehrfach
                                ankreuzen, es ist kein Entweder-oder. */}
                            <span className={`w-3.5 h-3.5 shrink-0 border flex items-center justify-center
                              ${aktiv ? 'border-white bg-white' : 'border-ink-300'}`}>
                              {aktiv && (
                                <svg className="w-2.5 h-2.5 text-heron-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                            {f.label}
                          </span>
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
            <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="label-section">Varianten</span>
              <div className="bg-cream-100 rounded-xl p-1 flex gap-1">
                {([1, 2, 3] as const).map((n) => (
                  <button key={n} onClick={() => setVariantCount(n)}
                    title={n === 1 ? 'Ein Bild' : `${n} Bilder aus demselben Prompt — zum Auswählen`}
                    className={`mode-btn text-xs py-2 ${variantCount === n ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                    {n}×
                  </button>
                ))}
              </div>
              <span className="text-[10px] font-sans text-ink-400 leading-snug px-0.5">
                {(() => {
                  const gesamt = variantCount * Math.max(aktiveModelle.length, 1)
                  return gesamt === 1
                    ? 'Ein Bild.'
                    : `${gesamt} Aufrufe, also auch ${gesamt}× die Kosten.`
                })()}
              </span>
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
            {alleGpt && (
              <p className="text-[11px] font-sans text-ink-400 mt-0.5">
                {modellDef(selectedModel).hint} rendert in jedem Format nativ — 4K erreicht max. ~8.3 MP (z.B. 3840×2160 bei 16:9, 2880×2880 bei 1:1, 3072×2048 bei 3:2).
              </p>
            )}
          </div>
          {alleTransparenz && (
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
          {alleGpt && (
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
                {aktiveModelle.length > 1
                  ? `${aktiveModelle.length} Modelle rechnen…`
                  : `${modellDef(selectedModel).label} generiert…`}
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {(() => {
                  const gesamt = variantCount * Math.max(aktiveModelle.length, 1)
                  const wer = aktiveModelle.length > 1
                    ? `${aktiveModelle.length} Modellen`
                    : modellDef(selectedModel).label
                  return gesamt > 1 ? `${gesamt} Bilder mit ${wer} generieren` : `mit ${wer} generieren`
                })()}
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
  const [aktiverJob, setAktiverJob] = useState<number | null>(null)
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
  const [quickVariants, setQuickVariants] = useState<1 | 2 | 3>(1)
  const [quickResults, setQuickResults] = useState<string[]>([])
  const [quickProgress, setQuickProgress] = useState<{ done: number; total: number } | null>(null)

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

  // Je Auftrag ein Lesezugriff auf seinen Stand, vom Panel selbst gemeldet.
  // So lässt sich duplizieren, ohne den gesamten Zustand nach oben zu ziehen.
  const abzuege = useRef(new Map<number, () => JobVorlage>())
  const [vorlagen, setVorlagen] = useState<Record<number, JobVorlage>>({})

  // Ein neuer oder duplizierter Auftrag wird gleich der offene Reiter — sonst
  // müsste man nach dem Klick noch einmal klicken.
  const addJob = useCallback(() => {
    const id = Date.now()
    setJobs((prev) => [...prev, id])
    setAktiverJob(id)
  }, [])

  const duplicateJob = useCallback((id: number) => {
    const lies = abzuege.current.get(id)
    if (!lies) return
    const neu = Date.now()
    setVorlagen((prev) => ({ ...prev, [neu]: lies() }))
    // Das Duplikat direkt neben das Original, nicht ans Ende.
    setJobs((prev) => {
      const i = prev.indexOf(id)
      return [...prev.slice(0, i + 1), neu, ...prev.slice(i + 1)]
    })
    setAktiverJob(neu)
  }, [])

  const removeJob = useCallback((id: number) => {
    setJobs((prev) => {
      const rest = prev.filter((j) => j !== id)
      setAktiverJob((offen) => {
        if (offen !== id) return offen
        // Auf den Nachbarn springen statt ins Leere.
        const i = prev.indexOf(id)
        return rest[Math.min(i, rest.length - 1)] ?? null
      })
      return rest
    })
    abzuege.current.delete(id)
  }, [])

  const offenerJob = aktiverJob !== null && jobs.includes(aktiverJob) ? aktiverJob : jobs[0]

  const handleQuickGenerate = useCallback(async () => {
    if (!quickPrompt.trim()) return
    setQuickStatus('generating'); setQuickError(null); setQuickImage(null)
    setQuickResults([]); setQuickProgress({ done: 0, total: quickVariants })
    const fertig: string[] = []
    const fehler: string[] = []
    // Nacheinander, damit das erste Bild sofort dasteht.
    for (let v = 1; v <= quickVariants; v++) {
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
        fertig.push(data.image)
        setQuickResults([...fertig])
        if (fertig.length === 1) setQuickImage(data.image)
      } catch (e) {
        fehler.push(`Variante ${v}: ${e instanceof Error ? e.message : 'Fehler'}`)
      }
      setQuickProgress({ done: fertig.length + fehler.length, total: quickVariants })
    }
    setQuickProgress(null)
    if (fertig.length === 0) {
      setQuickError(fehler.join(' · ') || 'Fehler')
      setQuickStatus('error')
      return
    }
    setQuickError(fehler.length > 0 ? `${fehler.length} von ${quickVariants} fehlgeschlagen — ${fehler.join(' · ')}` : null)
    setQuickStatus('done')
  }, [quickPrompt, quickModel, quickResolution, quickAspectRatio, quickOutputFormat,
      quickTransparent, quickVariants])

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
            Referenzbilder hochladen · Lock-Regeln setzen · Der Prompt entsteht automatisch · Gemini oder OpenAI rendert das Bild.
          </p>
        </div>
      </div>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      {/* Feste Breite: Es ist immer nur ein Auftrag offen, die Seite soll beim
          Reiterwechsel nicht springen. */}
      <main className="max-w-4xl mx-auto w-full px-5 py-8 flex flex-col gap-6">

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
                <span className="label-section text-[10px]">Varianten</span>
                <div className="bg-cream-100 rounded-xl p-0.5 flex gap-0.5">
                  {([1, 2, 3] as const).map((n) => (
                    <button key={n} onClick={() => setQuickVariants(n)}
                      title={n === 1 ? 'Ein Bild' : `${n} Bilder aus demselben Prompt — zum Auswählen`}
                      className={`mode-btn text-xs py-1.5 ${quickVariants === n ? 'mode-btn-active' : 'mode-btn-inactive'}`}>
                      {n}×
                    </button>
                  ))}
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
            {quickProgress && quickProgress.total > 1 && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-cream-200">
                  <div className="h-full bg-heron-500 transition-all duration-300"
                    style={{ width: `${(quickProgress.done / quickProgress.total) * 100}%` }} />
                </div>
                <span className="text-[11px] font-sans text-ink-400 tabular-nums">
                  {quickProgress.done}/{quickProgress.total}
                </span>
              </div>
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

            {/* Die Serie zum Auswählen — ein Klick macht ein Bild zum aktiven. */}
            {quickResults.length > 1 && (
              <div className="flex flex-col gap-1 animate-fade-in">
                <span className="label-section text-[10px]">Ergebnisse ({quickResults.length})</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {quickResults.map((bild, i) => (
                    <button key={i} onClick={() => setQuickImage(bild)}
                      title={`Variante ${i + 1} als aktives Bild setzen`}
                      className="relative block overflow-hidden border border-cream-200 bg-cream-100">
                      <img src={bild} alt={`Variante ${i + 1}`} className="w-full aspect-square object-cover" />
                      <span className="absolute inset-x-0 bottom-0 bg-ink-900/70 text-white text-[10px] font-sans py-1">
                        Variante {i + 1}
                      </span>
                      {quickImage === bild && (
                        <span className="absolute inset-0 ring-2 ring-heron-500 pointer-events-none" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Aufträge als Reiter. Alle Panels bleiben im Baum — ausgeblendet
            statt entfernt, sonst wären beim Zurückspringen Bilder, Prompt und
            Einstellungen weg. */}
        <div className="flex flex-col gap-0">
          <div className="flex items-stretch gap-px bg-cream-200 border-b-2 border-cream-200 overflow-x-auto">
            {jobs.map((id, i) => (
              <button key={id} onClick={() => setAktiverJob(id)}
                className={`group flex items-center gap-2 px-4 py-2.5 font-display font-bold uppercase tracking-wide text-sm whitespace-nowrap transition-colors duration-150
                  ${id === offenerJob ? 'bg-heron-500 text-white' : 'bg-white text-ink-400 hover:text-ink-800 hover:bg-cream-50'}`}>
                Auftrag {i + 1}
                {jobs.length > 1 && (
                  <span role="button" tabIndex={0} title="Diesen Auftrag schließen"
                    onClick={(e) => { e.stopPropagation(); removeJob(id) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeJob(id) } }}
                    className={`-mr-1.5 w-5 h-5 flex items-center justify-center transition-colors duration-150
                      ${id === offenerJob ? 'text-white/60 hover:text-white hover:bg-heron-700' : 'text-ink-300 hover:text-white hover:bg-red-500'}`}>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                )}
              </button>
            ))}
            <button onClick={() => duplicateJob(offenerJob)} title="Offenen Auftrag duplizieren — Bilder und Einstellungen werden übernommen, die Ergebnisse nicht"
              className="px-3 py-2.5 bg-white text-ink-400 hover:bg-ink-800 hover:text-white transition-colors duration-150 flex items-center"
              aria-label="Offenen Auftrag duplizieren">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            <button onClick={addJob} title="Weiteren Auftrag öffnen"
              className="px-4 py-2.5 bg-white text-heron-600 hover:bg-heron-500 hover:text-white transition-colors duration-150 flex items-center"
              aria-label="Weiteren Auftrag öffnen">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <div className="flex-1 bg-white" />
          </div>
          {jobs.map((id) => (
            <div key={id} hidden={id !== offenerJob} className="pt-5">
              <JobPanel
                vorlage={vorlagen[id]}
                onAbzug={(lies) => { abzuege.current.set(id, lies) }}
              />
            </div>
          ))}
        </div>

      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-cream-200 bg-white mt-auto">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <p className="text-ink-300 text-xs font-sans">Heron AI Studio</p>
          <p className="text-ink-300 text-xs font-sans">Prompt: Gemini Flash · {GEN_MODELS.map((m) => m.label).join(' · ')}</p>
        </div>
      </footer>
    </div>
  )
}

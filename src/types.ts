import type { RefRolle } from './referenzen'

export interface UploadedImage {
  id: string
  file: File
  preview: string // object URL
  name: string
  size: number
  /**
   * Wofür dieses Bild da ist. „ausgang" = woraus etwas entsteht (wird
   * originalgetreu übernommen, inklusive Gesicht), „ziel" = wie das Ergebnis
   * aussehen soll (Farbe, Licht, Perspektive, Ausschnitt — NICHT die Objekte
   * oder Personen daraus).
   */
  rolle: RefRolle
  /** Pixelmaße, sobald bekannt — für den Auflösungshinweis vor der Generierung. */
  breite?: number
  hoehe?: number
  /**
   * Stammt dieses Bild aus einer PDF-Seite? Dann bleibt die Quelldatei hier
   * liegen, damit sich eine Doppelseite nachträglich noch teilen lässt, ohne
   * dass man das PDF erneut hochladen muss.
   */
  pdfQuelle?: File
  pdfSeite?: number
  /** Quer und etwa doppelt so breit wie hoch — könnte eine Doppelseite sein. */
  vielleichtDoppelseite?: boolean
  // Per-image lock settings
  faceLock: boolean
  objectLock: boolean
  customLock: string
}

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error'

export type GenerationStatus = 'idle' | 'generating' | 'done' | 'error'

export type PromptMode = 'retouch' | 'mockup' | 'generation'

export type MockupType =
  | 'folder' | 'flyer' | 'billboard' | 'webseite' | 'tshirt'
  | 'tasse' | 'buch' | 'visitenkarte' | 'flasche' | 'verpackung'

export interface MockupTypeDef {
  id: MockupType
  label: string
}

export const MOCKUP_TYPES: MockupTypeDef[] = [
  { id: 'folder',      label: 'Mappe' },
  { id: 'flyer',       label: 'Flyer' },
  { id: 'billboard',   label: 'Billboard' },
  { id: 'webseite',    label: 'Webseite' },
  { id: 'tshirt',      label: 'T-Shirt' },
  { id: 'tasse',       label: 'Tasse' },
  { id: 'buch',        label: 'Buch' },
  { id: 'visitenkarte',label: 'Visitenkarte' },
  { id: 'flasche',     label: 'Flasche' },
  { id: 'verpackung',  label: 'Verpackung' },
]

// ── Image-generation model config ────────────────────────────────────────────

export type GenModel = 'flare' | 'sunburst' | 'openai' | 'pro' | 'flash'

/** Anbieter-Familie. Die Oberfläche zeigt zwei Schalter, je einen pro Familie. */
export type GenFamilie = 'gpt' | 'nano'

export interface GenModelDef {
  id: GenModel
  familie: GenFamilie
  label: string
  hint: string
  ratios: string[]
  /** Wofür dieses Modell da ist — steht im Dropdown und im Hover. */
  staerke: string
  /** Ungefährer Preis je Bild nach Auflösungsstufe, in US-Dollar. */
  preis: Record<'1K' | '2K' | '4K', string>
}

export const GEMINI_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4']
// gpt-image-2 supports any size with both edges divisible by 16, max edge ≤3840,
// total pixels ≤8.3MP, long:short ratio ≤3:1 — so the same ratios as Gemini work,
// plus the editorial 3:2 / 2:3 photo ratios.
export const OPENAI_RATIOS = ['auto', '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4']

// WebP requests silently return PNG from the OpenAI API, so we don't advertise it.
export type OpenAIFormat = 'auto' | 'png' | 'jpeg'
export const OPENAI_FORMATS: OpenAIFormat[] = ['auto', 'png', 'jpeg']

// GPT Image steht vorn: gpt-image-2.5 Flare ist die Voreinstellung — höhere
// Qualität als gpt-image-2 bei etwa halber Wartezeit.
//
// Preise: Bei den Gemini-Modellen nennt Google feste Beträge je Bild und
// Auflösung — die stehen so in der Preisliste.
//
// Bei OpenAI wird nach Token abgerechnet, $30 je 1 Mio. Ausgabe-Token, für alle
// drei Modelle gleich. Die Ankündigung von 2.5 Flare verspricht 50 % weniger
// LATENZ, nicht 50 % weniger Kosten. Gemessen ist nur gpt-image-2 in 4K
// (~$0.71); 1K und 2K sind daraus über Pixelzahl und Qualitätsstufe
// hochgerechnet.
//
// Für Flare und Sunburst sind dieselben Beträge eingetragen — mit Vorbehalt:
// OpenAI schreibt zwar „token rates match GPT Image 2", zugleich aber, dass der
// gpt-image-2-Rechner den Verbrauch von 2.5 NICHT abbildet. Der Tokenverbrauch
// je Bild kann also abweichen. Sobald ein paar echte Abrechnungen vorliegen,
// gehören die gemessenen Werte hierher. Alle „ca."-Beträge sind Richtwerte,
// keine Tatsachen.
export const GEN_MODELS: GenModelDef[] = [
  {
    id: 'flare', familie: 'gpt', label: 'GPT Image 2.5 Flare',
    hint: 'gpt-image-2.5-flare', ratios: OPENAI_RATIOS,
    staerke: 'Schnell und trotzdem besser als gpt-image-2 — der Normalfall',
    preis: { '1K': 'ca. $0.09', '2K': 'ca. $0.36', '4K': 'ca. $0.71' },
  },
  {
    id: 'sunburst', familie: 'gpt', label: 'GPT Image 2.5 Sunburst',
    hint: 'gpt-image-2.5-sunburst', ratios: OPENAI_RATIOS,
    staerke: 'Höchste Qualität und die genaueste Kontrolle bei Bearbeitungen',
    preis: { '1K': 'ca. $0.09', '2K': 'ca. $0.36', '4K': 'ca. $0.71' },
  },
  {
    id: 'openai', familie: 'gpt', label: 'ChatGPT Image',
    hint: 'gpt-image-2', ratios: OPENAI_RATIOS,
    staerke: 'Die vorige Fassung — nur nötig, wenn ein Ergebnis reproduziert werden soll',
    preis: { '1K': 'ca. $0.09', '2K': 'ca. $0.36', '4K': 'ca. $0.71' },
  },
  {
    id: 'pro', familie: 'nano', label: 'Nano Banana Pro',
    hint: 'gemini-3-pro-image', ratios: GEMINI_RATIOS,
    staerke: 'Kräftige, saubere Bilder und der beste Umgang mit vielen Referenzen',
    preis: { '1K': '$0.134', '2K': '$0.134', '4K': '$0.24' },
  },
  {
    id: 'flash', familie: 'nano', label: 'Nano Banana 2',
    hint: 'gemini-3.1-flash-image', ratios: GEMINI_RATIOS,
    staerke: 'Das günstigste und schnellste — gut für Entwürfe und viele Varianten',
    preis: { '1K': '$0.067', '2K': '$0.101', '4K': '$0.151' },
  },
]

export interface GenFamilieDef {
  id: GenFamilie
  label: string
  /** Kurzcharakteristik für den Hover über dem Schalter. */
  koennen: string
  /** Preisspanne über alle Modelle der Familie, für den Hover. */
  preis: string
}

export const GEN_FAMILIEN: GenFamilieDef[] = [
  {
    id: 'gpt', label: 'GPT Image',
    koennen: 'Folgt langen, genauen Anweisungen am zuverlässigsten und hält bei '
      + 'Bearbeitungen fest, was unverändert bleiben soll — deshalb die erste Wahl, '
      + 'wenn ein Gesicht oder ein Aufdruck exakt stimmen muss. Beherrscht als '
      + 'einzige Familie transparente Hintergründe.',
    preis: 'ca. $0.09 (1K) bis $0.71 (4K) je Bild — Richtwert von gpt-image-2',
  },
  {
    id: 'nano', label: 'Nano Banana',
    koennen: 'Deutlich günstiger und meist schneller, stark bei Licht, Farbe und '
      + 'fotografischer Anmutung. Verträgt viele Referenzbilder auf einmal. Kein '
      + 'transparenter Hintergrund.',
    preis: '$0.067 bis $0.24 je Bild',
  },
]

export const STANDARD_MODELL: GenModel = 'flare'

const GPT_MODELLE: GenModel[] = ['flare', 'sunburst', 'openai']

/** Gehört das Modell zur GPT-Image-Familie? Entscheidet über Größen und Optionen. */
export function istGpt(id: GenModel): boolean {
  return GPT_MODELLE.includes(id)
}

export function familieVon(id: GenModel): GenFamilie {
  return istGpt(id) ? 'gpt' : 'nano'
}

/** Nur gpt-image-2.5 kann freigestellt ausgeben. */
export function kannTransparenz(id: GenModel): boolean {
  return id === 'flare' || id === 'sunburst'
}

export function modellDef(id: GenModel): GenModelDef {
  return GEN_MODELS.find((m) => m.id === id) ?? GEN_MODELS[0]
}

/**
 * Erwartete Laufzeit in Sekunden, gemessen mit vielen Referenzbildern.
 * Ohne Referenzbilder ist es spürbar schneller, mit 4K und vielen Bildern
 * eher am oberen Rand.
 */
const DAUER: Record<GenModel, Record<'1K' | '2K' | '4K', [number, number]>> = {
  flash:  { '1K': [15, 30], '2K': [20, 45], '4K': [35, 70] },
  pro:    { '1K': [25, 60], '2K': [30, 90], '4K': [40, 110] },
  openai: { '1K': [25, 50], '2K': [45, 90], '4K': [110, 180] },
  // Nicht gemessen, sondern aus der Ankündigung abgeleitet: Flare nennt „50 %
  // geringere Latenz" gegenüber gpt-image-2, Sunburst liegt etwa gleichauf.
  // Sobald eigene Läufe vorliegen, gehören hier die echten Werte hin.
  flare:    { '1K': [13, 25], '2K': [22, 45], '4K': [55, 90] },
  sunburst: { '1K': [25, 50], '2K': [45, 90], '4K': [105, 175] },
}

export function dauerHinweis(model: GenModel, resolution?: string): string {
  const stufe = resolution === '4K' ? '4K' : resolution === '1K' ? '1K' : '2K'
  const [von, bis] = DAUER[model]?.[stufe] ?? [20, 60]
  return `${von}–${bis} Sekunden`
}

export function ratiosForModel(model: GenModel): string[] {
  return GEN_MODELS.find((m) => m.id === model)?.ratios ?? GEMINI_RATIOS
}

export type FocusArea =
  | 'pose' | 'lighting' | 'color' | 'background' // change group

export interface FocusAreaDef {
  id: FocusArea
  label: string
  hint: string
}

export const CHANGE_AREAS: FocusAreaDef[] = [
  { id: 'pose',       label: 'Pose',        hint: 'Körperhaltung, Abstände, Winkel & Ausdrücke anpassen'           },
  { id: 'lighting',   label: 'Beleuchtung', hint: 'Kamera-Setup, Haupt-/Füll-/Kantenlicht, Catchlights verbessern' },
  { id: 'color',      label: 'Farbgebung',  hint: 'Farbton, Schatten, Kontrast & Grading anpassen'                },
  { id: 'background', label: 'Hintergrund', hint: 'Hintergrund ersetzen oder Umgebung verbessern'                 },
]

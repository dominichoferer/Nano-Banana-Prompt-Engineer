export interface UploadedImage {
  id: string
  file: File
  preview: string // object URL
  name: string
  size: number
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
  icon: string
  label: string
}

export const MOCKUP_TYPES: MockupTypeDef[] = [
  { id: 'folder',      icon: '📁', label: 'Mappe' },
  { id: 'flyer',       icon: '📄', label: 'Flyer' },
  { id: 'billboard',   icon: '🗣️', label: 'Billboard' },
  { id: 'webseite',    icon: '🖥️', label: 'Webseite' },
  { id: 'tshirt',      icon: '👕', label: 'T-Shirt' },
  { id: 'tasse',       icon: '☕', label: 'Tasse' },
  { id: 'buch',        icon: '📚', label: 'Buch' },
  { id: 'visitenkarte',icon: '💳', label: 'Visitenkarte' },
  { id: 'flasche',     icon: '🧴', label: 'Flasche' },
  { id: 'verpackung',  icon: '📦', label: 'Verpackung' },
]

// ── Image-generation model config ────────────────────────────────────────────

export type GenModel = 'flash' | 'pro' | 'openai'

export interface GenModelDef {
  id: GenModel
  icon: string
  label: string
  hint: string
  ratios: string[]
}

export const ALL_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4'] as const
export const OPENAI_RATIOS = ['1:1', '16:9', '9:16']

export const GEN_MODELS: GenModelDef[] = [
  { id: 'flash',  icon: '⚡', label: 'Flash',  hint: 'schnell',   ratios: [...ALL_RATIOS] },
  { id: 'pro',    icon: '✦',  label: 'Pro',    hint: 'best',      ratios: [...ALL_RATIOS] },
  { id: 'openai', icon: '🎨', label: 'OpenAI', hint: 'gpt-image', ratios: OPENAI_RATIOS   },
]

export function ratiosForModel(model: GenModel): string[] {
  return GEN_MODELS.find((m) => m.id === model)?.ratios ?? [...ALL_RATIOS]
}

export type FocusArea =
  | 'pose' | 'lighting' | 'color' | 'background' // change group

export interface FocusAreaDef {
  id: FocusArea
  icon: string
  label: string
  hint: string
}

export const CHANGE_AREAS: FocusAreaDef[] = [
  { id: 'pose',       icon: '🧍', label: 'Pose',        hint: 'Körperhaltung, Abstände, Winkel & Ausdrücke anpassen'           },
  { id: 'lighting',   icon: '💡', label: 'Beleuchtung', hint: 'Kamera-Setup, Haupt-/Füll-/Kantenlicht, Catchlights verbessern' },
  { id: 'color',      icon: '🎨', label: 'Farbgebung',  hint: 'Farbton, Schatten, Kontrast & Grading anpassen'                },
  { id: 'background', icon: '🏞️', label: 'Hintergrund', hint: 'Hintergrund ersetzen oder Umgebung verbessern'                 },
]

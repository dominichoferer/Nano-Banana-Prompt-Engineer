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

export type PromptMode = 'retouch' | 'generation'

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

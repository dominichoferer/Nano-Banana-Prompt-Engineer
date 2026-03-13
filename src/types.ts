export interface UploadedImage {
  id: string
  file: File
  preview: string // object URL
  name: string
  size: number
}

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error'

export type PromptMode = 'retouch' | 'generation'

export type FocusArea = 'subject' | 'face' | 'pose' | 'lighting' | 'color' | 'skin' | 'background' | 'clothing'

export const FOCUS_AREAS: { id: FocusArea; icon: string; label: string; hint: string }[] = [
  { id: 'subject',    icon: '📐', label: 'Proportionen',  hint: 'Proportionen, Silhouette & Komposition — kein Morphing'       },
  { id: 'face',       icon: '🔒', label: 'Gesicht-Lock',  hint: 'Pixelgenaue Gesichtsmerkmale jeder Person erhalten'           },
  { id: 'pose',       icon: '🧍', label: 'Pose',          hint: 'Körperhaltung, Abstände, Winkel & Ausdrücke'                  },
  { id: 'lighting',   icon: '💡', label: 'Beleuchtung',   hint: 'Kamera-Setup, Haupt-/Füll-/Kantenlicht, Catchlights'         },
  { id: 'color',      icon: '🎨', label: 'Farbgebung',    hint: 'Farbton, Schatten, Kontrast & Referenzpublikationen'         },
  { id: 'skin',       icon: '✨', label: 'Haut',          hint: 'Retuschetechnik & Ergebnis-Qualität'                         },
  { id: 'background', icon: '🏞️', label: 'Hintergrund',   hint: 'Exakter Austausch oder Umgebungsverbesserung'                },
  { id: 'clothing',   icon: '👗', label: 'Kleidung',      hint: 'Jedes Teil, Farbe, Material & Accessoires'                   },
]

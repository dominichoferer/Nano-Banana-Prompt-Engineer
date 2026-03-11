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
  { id: 'subject',    icon: '📐', label: 'Subject Lock',  hint: 'Proportions, silhouette & composition — no morphing'  },
  { id: 'face',       icon: '🔒', label: 'Face Lock',     hint: 'Pixel-perfect facial features for every person'        },
  { id: 'pose',       icon: '🧍', label: 'Pose',          hint: 'Body alignment, spacing, angles & expressions'         },
  { id: 'lighting',   icon: '💡', label: 'Lighting',      hint: 'Camera specs, key/fill/rim lights, catchlights'        },
  { id: 'color',      icon: '🎨', label: 'Color Grade',   hint: 'Tone, shadows, contrast & publication references'      },
  { id: 'skin',       icon: '✨', label: 'Skin',          hint: 'Retouching technique & finish quality'                 },
  { id: 'background', icon: '🏞️', label: 'Background',    hint: 'Exact replacement or environment enhancement'          },
  { id: 'clothing',   icon: '👗', label: 'Clothing',      hint: 'Every item, color, material & accessories'             },
]

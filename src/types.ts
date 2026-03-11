export interface UploadedImage {
  id: string
  file: File
  preview: string // object URL
  name: string
  size: number
}

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error'

export type PromptMode = 'retouch' | 'generation'

export type FocusArea = 'face' | 'pose' | 'lighting' | 'color' | 'skin' | 'background' | 'clothing'

export const FOCUS_AREAS: { id: FocusArea; icon: string; label: string }[] = [
  { id: 'face',       icon: '🔒', label: 'Face Lock'   },
  { id: 'pose',       icon: '🧍', label: 'Pose'        },
  { id: 'lighting',   icon: '💡', label: 'Lighting'    },
  { id: 'color',      icon: '🎨', label: 'Color Grade' },
  { id: 'skin',       icon: '✨', label: 'Skin'        },
  { id: 'background', icon: '🏞️', label: 'Background'  },
  { id: 'clothing',   icon: '👗', label: 'Clothing'    },
]

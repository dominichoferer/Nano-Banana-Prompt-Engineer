export interface UploadedImage {
  id: string
  file: File
  preview: string // object URL
  name: string
  size: number
}

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error'

export type PromptMode = 'retouch' | 'generation'

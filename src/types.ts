export interface UploadedImage {
  id: string
  file: File
  preview: string // object URL
  name: string
  size: number
}

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error'
export type GenerationStatus = 'idle' | 'generating' | 'done' | 'error'

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '2:3' | '3:2' | '5:4' | '4:5'

export type Resolution = '1K' | '2K' | '4K'

export interface GenerateResponse {
  image: string // data:image/jpeg;base64,...
  prompt: string
  model?: string
}

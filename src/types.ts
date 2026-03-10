export interface UploadedImage {
  id: string
  file: File
  preview: string // object URL
  name: string
  size: number
}

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error'
export type GenerationStatus = 'idle' | 'generating' | 'done' | 'error'

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'

export interface GenerateResponse {
  image: string // data:image/jpeg;base64,...
  prompt: string
}

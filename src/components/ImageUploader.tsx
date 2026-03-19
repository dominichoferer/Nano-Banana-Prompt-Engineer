import { useCallback, useRef } from 'react'
import type { UploadedImage } from '../types'

interface Props {
  images: UploadedImage[]
  onChange: (images: UploadedImage[]) => void
  disabled?: boolean
}

function createUploadedImage(file: File): UploadedImage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    preview: URL.createObjectURL(file),
    name: file.name,
    size: file.size,
    faceLock: false,
    objectLock: false,
    customLock: '',
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ImageUploader({ images, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const accepted = Array.from(files).filter((f) =>
        f.type.startsWith('image/')
      )
      const newImages = accepted.map(createUploadedImage)
      onChange([...images, ...newImages])
    },
    [images, onChange]
  )

  const removeImage = useCallback(
    (id: string) => {
      const img = images.find((i) => i.id === id)
      if (img) URL.revokeObjectURL(img.preview)
      onChange(images.filter((i) => i.id !== id))
    },
    [images, onChange]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dropRef.current?.classList.remove('drag-over')
      if (!disabled) addFiles(e.dataTransfer.files)
    },
    [addFiles, disabled]
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!disabled) dropRef.current?.classList.add('drag-over')
  }

  const handleDragLeave = () => {
    dropRef.current?.classList.remove('drag-over')
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ''
  }

  const clearAll = () => {
    images.forEach((img) => URL.revokeObjectURL(img.preview))
    onChange([])
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Drop Zone */}
      <div
        ref={dropRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-3
          border-2 border-dashed border-[#3a3a3a] rounded-2xl
          min-h-[180px] cursor-pointer select-none
          transition-all duration-200
          ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-banana-500/60 hover:bg-banana-500/5'}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileInput}
          disabled={disabled}
        />

        <div className="flex flex-col items-center gap-2 p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#1e1e1e] flex items-center justify-center text-3xl">
            🖼️
          </div>
          <div>
            <p className="text-white font-medium text-sm">
              Drop images here or{' '}
              <span className="text-banana-500 underline underline-offset-2">browse</span>
            </p>
            <p className="text-dark-400 text-xs mt-1">
              JPEG, PNG, WebP, GIF · max 20 MB each · up to 10 images
            </p>
          </div>
        </div>
      </div>

      {/* Image Grid */}
      {images.length > 0 && (
        <div className="flex flex-col gap-2 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="section-label">{images.length} image{images.length !== 1 ? 's' : ''} selected</span>
            <button
              onClick={clearAll}
              disabled={disabled}
              className="btn-ghost text-xs py-1 px-2 text-dark-400 hover:text-red-400"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear all
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 max-h-[340px] overflow-y-auto pr-1">
            {images.map((img) => (
              <div
                key={img.id}
                className="relative group rounded-xl overflow-hidden bg-[#1e1e1e] aspect-square"
              >
                <img
                  src={img.preview}
                  alt={img.name}
                  className="w-full h-full object-cover"
                />
                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-2 p-2">
                  <p className="text-white text-xs font-medium text-center truncate w-full px-2">
                    {img.name}
                  </p>
                  <p className="text-dark-300 text-xs">{formatBytes(img.size)}</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeImage(img.id) }}
                    disabled={disabled}
                    className="mt-1 bg-red-500/80 hover:bg-red-500 text-white text-xs px-3 py-1 rounded-lg transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {/* Add more button */}
            <div
              onClick={() => !disabled && inputRef.current?.click()}
              className={`
                aspect-square rounded-xl border-2 border-dashed border-[#3a3a3a]
                flex flex-col items-center justify-center gap-1
                transition-all duration-200
                ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-banana-500/60 hover:bg-banana-500/5 cursor-pointer'}
              `}
            >
              <span className="text-2xl">+</span>
              <span className="text-xs text-dark-400">Add more</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

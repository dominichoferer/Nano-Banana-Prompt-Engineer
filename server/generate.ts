import type { Request, Response } from 'express'

interface PredictResponse {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
  error?: { message: string; code: number }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }
  }>
  error?: { message: string; code: number }
}

type ImageResult = { base64: string; mimeType: string; model: string }

async function callGeminiGenerateContent(model: string, prompt: string, apiKey: string, label: string): Promise<ImageResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  })
  const data = await res.json() as GeminiResponse
  if (!res.ok) throw new Error(data.error?.message || `${label} error ${res.status}`)
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const img = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'))
  if (!img?.inlineData) throw new Error(`No image from ${label}`)
  return { base64: img.inlineData.data, mimeType: img.inlineData.mimeType, model: label }
}

async function callImagen3(prompt: string, aspectRatio: string, apiKey: string): Promise<ImageResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio } }),
  })
  const data = await res.json() as PredictResponse
  if (!res.ok) throw new Error(data.error?.message || `Imagen 3 error ${res.status}`)
  const pred = data.predictions?.[0]
  if (!pred?.bytesBase64Encoded) throw new Error('No image from Imagen 3')
  return { base64: pred.bytesBase64Encoded, mimeType: pred.mimeType || 'image/png', model: 'Imagen 3' }
}

export async function generateImage(req: Request, res: Response) {
  try {
    const { prompt, aspectRatio = '1:1' } = req.body as { prompt: string; aspectRatio?: string }
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' })
    if (!process.env.GOOGLE_AI_API_KEY) return res.status(500).json({ error: 'GOOGLE_AI_API_KEY not configured' })

    const apiKey = process.env.GOOGLE_AI_API_KEY
    const p = prompt.trim()

    const attempts: Array<() => Promise<ImageResult>> = [
      () => callGeminiGenerateContent('gemini-3-pro-image-preview', p, apiKey, 'Gemini 3 Pro'),
      () => callImagen3(p, aspectRatio, apiKey),
      () => callGeminiGenerateContent('gemini-2.0-flash-preview-image-generation', p, apiKey, 'Gemini 2.0 Flash'),
    ]

    let result: ImageResult | null = null
    let lastError = ''
    for (const attempt of attempts) {
      try { result = await attempt(); break }
      catch (e) { lastError = e instanceof Error ? e.message : String(e); console.warn('Attempt failed:', lastError) }
    }

    if (!result) return res.status(500).json({ error: `All models failed. Last: ${lastError}` })

    res.json({ image: `data:${result.mimeType};base64,${result.base64}`, prompt: p, model: result.model })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}

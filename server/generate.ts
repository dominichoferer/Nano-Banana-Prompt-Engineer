import type { Request, Response } from 'express'

interface PredictResponse {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
  error?: { message: string; code: number }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        inlineData?: { mimeType: string; data: string }
      }>
    }
  }>
  error?: { message: string; code: number }
}

async function tryImagen3(prompt: string, aspectRatio: string, apiKey: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio },
    }),
  })
  const data = await res.json() as PredictResponse
  if (!res.ok) throw new Error(data.error?.message || `Imagen 3 error ${res.status}`)
  const prediction = data.predictions?.[0]
  if (!prediction?.bytesBase64Encoded) throw new Error('No image from Imagen 3')
  return { base64: prediction.bytesBase64Encoded, mimeType: prediction.mimeType || 'image/png', model: 'Imagen 3' }
}

async function tryGeminiFlash(prompt: string, apiKey: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  })
  const data = await res.json() as GeminiResponse
  if (!res.ok) throw new Error(data.error?.message || `Gemini error ${res.status}`)
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'))
  if (!imagePart?.inlineData) throw new Error('No image from Gemini Flash')
  return { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType, model: 'Gemini 2.0 Flash' }
}

export async function generateImage(req: Request, res: Response) {
  try {
    const { prompt, aspectRatio = '1:1' } = req.body as { prompt: string; aspectRatio?: string }

    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' })
    if (!process.env.GOOGLE_AI_API_KEY) return res.status(500).json({ error: 'GOOGLE_AI_API_KEY not configured' })

    const apiKey = process.env.GOOGLE_AI_API_KEY
    const trimmedPrompt = prompt.trim()

    let result: { base64: string; mimeType: string; model: string }
    try {
      result = await tryImagen3(trimmedPrompt, aspectRatio, apiKey)
    } catch (e) {
      console.warn('Imagen 3 unavailable, falling back:', e instanceof Error ? e.message : e)
      result = await tryGeminiFlash(trimmedPrompt, apiKey)
    }

    res.json({
      image: `data:${result.mimeType};base64,${result.base64}`,
      prompt: trimmedPrompt,
      model: result.model,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Generation error:', message)
    res.status(500).json({ error: message })
  }
}

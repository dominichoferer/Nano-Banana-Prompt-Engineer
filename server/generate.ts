import type { Request, Response } from 'express'

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }
  }>
  error?: { message: string; code: number }
}

const RESOLUTION_PX: Record<string, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
}

export async function generateImage(req: Request, res: Response) {
  try {
    const { prompt, aspectRatio, resolution } = req.body as {
      prompt: string
      aspectRatio?: string
      resolution?: string
    }
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' })
    if (!process.env.GOOGLE_AI_API_KEY) return res.status(500).json({ error: 'GOOGLE_AI_API_KEY not configured' })

    const apiKey = process.env.GOOGLE_AI_API_KEY

    // Build an enriched prompt with aspect ratio + resolution hints
    const resPx = resolution ? RESOLUTION_PX[resolution] : null
    const ratioHint = aspectRatio ? `, aspect ratio ${aspectRatio}` : ''
    const resHint = resPx ? `, ${resolution} resolution (${resPx}px)` : ''
    const p = `${prompt.trim()}${ratioHint}${resHint}`.trim()

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`
    const fetchRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: p }] }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          ...(aspectRatio ? { aspectRatio: aspectRatio.replace(':', '_') } : {}),
        },
      }),
    })
    const data = await fetchRes.json() as GeminiResponse
    if (!fetchRes.ok) throw new Error(data.error?.message || `Gemini 3 Pro error ${fetchRes.status}`)

    const parts = data.candidates?.[0]?.content?.parts ?? []
    const img = parts.find((part) => part.inlineData?.mimeType?.startsWith('image/'))
    if (!img?.inlineData) throw new Error('No image returned from Gemini 3 Pro')

    res.json({
      image: `data:${img.inlineData.mimeType};base64,${img.inlineData.data}`,
      prompt: p,
      model: 'Gemini 3 Pro',
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}

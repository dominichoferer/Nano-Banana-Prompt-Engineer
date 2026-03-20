import type { Request, Response } from 'express'

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }
  }>
  error?: { message: string; code: number }
}

const SUPPORTED_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4'])

// Model IDs as shown in Google AI Studio
const MODEL_IDS: Record<string, string> = {
  flash: 'gemini-3.1-flash-image-preview',
  pro:   'gemini-3-pro-image-preview',
}

const MODEL_LABELS: Record<string, string> = {
  flash: 'Gemini 3.1 Flash',
  pro:   'Gemini 3 Pro',
}

// Resolution prompt suffixes — actual pixel count controlled by API aspect ratio
const QUALITY_HINT: Record<string, string> = {
  '1K': 'high quality, detailed',
  '2K': 'ultra high quality, 2K resolution, highly detailed, sharp',
  '4K': 'ultra HD, 4K resolution, hyper-detailed, maximum sharpness, professional quality, ultra sharp edges, rich textures',
}

export async function generateImage(req: Request, res: Response) {
  try {
    const { prompt, aspectRatio, resolution, model } = req.body as {
      prompt: string
      aspectRatio?: string
      resolution?: string
      model?: 'flash' | 'pro'
    }

    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' })
    if (!process.env.GOOGLE_AI_API_KEY) return res.status(500).json({ error: 'GOOGLE_AI_API_KEY not configured' })

    const apiKey = process.env.GOOGLE_AI_API_KEY
    const modelKey = model ?? 'flash'
    const modelId = MODEL_IDS[modelKey]

    // Enrich prompt with quality and ratio hints
    const qualityHint = resolution ? QUALITY_HINT[resolution] ?? '' : ''
    const nativeRatio = aspectRatio && SUPPORTED_RATIOS.has(aspectRatio)
    const ratioHint = aspectRatio && !nativeRatio ? `, ${aspectRatio} aspect ratio` : ''
    const enrichedPrompt = [prompt.trim(), qualityHint, ratioHint].filter(Boolean).join(', ')

    // imageConfig with imageSize works for gemini-3-pro-image-preview (confirmed via testing)
    const imageConfig: Record<string, string> = {}
    if (resolution === '4K') imageConfig.imageSize = '4K'
    else if (resolution === '2K') imageConfig.imageSize = '2K'
    if (nativeRatio && aspectRatio) imageConfig.aspectRatio = aspectRatio

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`
    const body = {
      contents: [{ parts: [{ text: enrichedPrompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
      },
    }

    console.log(`[generate] model=${modelId} resolution=${resolution} ratio=${aspectRatio}`)

    const fetchRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await fetchRes.json() as GeminiResponse
    if (!fetchRes.ok) throw new Error(data.error?.message || `Gemini API error ${fetchRes.status}`)

    const parts = data.candidates?.[0]?.content?.parts ?? []
    const img = parts.find((part) => part.inlineData?.mimeType?.startsWith('image/'))
    if (!img?.inlineData) throw new Error('No image returned from Gemini')

    res.json({
      image: `data:${img.inlineData.mimeType};base64,${img.inlineData.data}`,
      prompt: enrichedPrompt,
      model: MODEL_LABELS[modelKey],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[generate] error:', message)
    res.status(500).json({ error: message })
  }
}

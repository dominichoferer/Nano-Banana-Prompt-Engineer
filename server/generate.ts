import type { Request, Response } from 'express'

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }
  }>
  error?: { message: string; code: number }
}

// Ratios natively supported by Gemini imageGenerationConfig
const SUPPORTED_API_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4'])

// Resolution quality hints mapped to prompt + API parameters
const RESOLUTION_CONFIG: Record<string, { hint: string; quality: string }> = {
  '1K': { hint: 'high quality, 1024px',           quality: 'standard' },
  '2K': { hint: 'ultra high quality, 2K, 2048px', quality: 'high'     },
  '4K': { hint: 'ultra HD, 4K, 4096px, hyper-detailed, maximum quality, ultra sharp', quality: 'high' },
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

    // Enrich prompt with resolution quality descriptors
    const resCfg = resolution ? RESOLUTION_CONFIG[resolution] : null
    const resHint = resCfg ? `, ${resCfg.hint}` : ''

    // Include aspect ratio as prompt hint if not natively supported by API
    const nativeRatio = aspectRatio && SUPPORTED_API_RATIOS.has(aspectRatio)
    const ratioHint = aspectRatio && !nativeRatio ? `, ${aspectRatio} aspect ratio` : ''

    const p = `${prompt.trim()}${ratioHint}${resHint}`.trim()

    // Build imageGenerationConfig with only supported parameters
    const imageGenerationConfig: Record<string, string> = {}
    if (nativeRatio && aspectRatio) imageGenerationConfig.aspectRatio = aspectRatio

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`
    const fetchRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: p }] }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          ...(Object.keys(imageGenerationConfig).length > 0
            ? { imageGenerationConfig }
            : {}),
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

import type { Request, Response } from 'express'

export interface GenerateRequest {
  prompt: string
  aspectRatio?: string
}

// Use the documented REST endpoint directly — the @google/genai SDK builds
// incorrect URLs for AI Studio API keys (missing /models/ prefix).
export async function generateImage(req: Request, res: Response) {
  try {
    const { prompt, aspectRatio = '1:1' } = req.body as GenerateRequest

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required' })
    }
    if (!process.env.GOOGLE_AI_API_KEY) {
      return res.status(500).json({ error: 'GOOGLE_AI_API_KEY not configured on server' })
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`

    const googleRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: prompt.trim() }],
        parameters: {
          sampleCount: 1,
          aspectRatio,
        },
      }),
    })

    const data = await googleRes.json() as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
      error?: { message: string; code: number }
    }

    if (!googleRes.ok) {
      const msg = data.error?.message || `Google API error ${googleRes.status}`
      return res.status(500).json({ error: msg })
    }

    const prediction = data.predictions?.[0]
    if (!prediction?.bytesBase64Encoded) {
      return res.status(500).json({ error: 'No image returned. The prompt may have been blocked by safety filters.' })
    }

    const mimeType = prediction.mimeType || 'image/png'
    res.json({
      image: `data:${mimeType};base64,${prediction.bytesBase64Encoded}`,
      prompt: prompt.trim(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Generation error:', message)
    res.status(500).json({ error: message })
  }
}

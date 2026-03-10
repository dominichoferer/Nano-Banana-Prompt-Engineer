import { GoogleGenAI } from '@google/genai'
import type { Request, Response } from 'express'

export interface GenerateRequest {
  prompt: string
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
}

export async function generateImage(req: Request, res: Response) {
  try {
    const { prompt, aspectRatio = '1:1' } = req.body as GenerateRequest

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    if (!process.env.GOOGLE_AI_API_KEY) {
      return res.status(500).json({ error: 'GOOGLE_AI_API_KEY not configured on server' })
    }

    const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY })

    const response = await client.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt: prompt.trim(),
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
        aspectRatio,
      },
    })

    const generatedImage = response.generatedImages?.[0]
    if (!generatedImage?.image) {
      return res.status(500).json({ error: 'No image was generated. The prompt may have been blocked by safety filters.' })
    }

    // imageBytes can be a base64 string or Uint8Array depending on SDK version
    const { imageBytes } = generatedImage.image
    if (!imageBytes) {
      return res.status(500).json({ error: 'Image data is empty' })
    }

    const base64 =
      typeof imageBytes === 'string'
        ? imageBytes
        : Buffer.from(imageBytes as Uint8Array).toString('base64')

    res.json({
      image: `data:image/jpeg;base64,${base64}`,
      prompt: prompt.trim(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Generation error:', message)
    res.status(500).json({ error: message })
  }
}

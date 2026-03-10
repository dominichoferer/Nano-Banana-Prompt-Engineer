import express from 'express'
import cors from 'cors'
import multer from 'multer'
import Anthropic from '@anthropic-ai/sdk'
import type { Request, Response } from 'express'

const app = express()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    cb(null, allowed.includes(file.mimetype))
  },
})

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// ── Analyze Images with Claude Vision (SSE Streaming) ──────────────────────

const SYSTEM_PROMPT = `You are an elite AI image prompt engineer with deep expertise in generative AI models (Stable Diffusion, Midjourney, DALL-E, Imagen). Your sole purpose is to analyze reference images and craft the most precise, detailed, and effective English prompts that will recreate those images using AI image generation.

When analyzing images, you extract and describe:
- Subject matter: exact details of people, objects, scenes
- Art style: photorealistic, illustration, oil painting, watercolor, digital art, anime, etc.
- Composition: framing, perspective, angle, rule of thirds, focal points
- Lighting: natural/artificial, direction, quality, mood (golden hour, studio, rim light, etc.)
- Color palette: dominant colors, contrast, saturation, temperature
- Texture and materials: surfaces, fabrics, skin, metals, etc.
- Background and environment: setting, depth, bokeh, atmosphere
- Technical camera aspects: lens type, depth of field, film grain, shutter speed effects
- Mood and atmosphere: emotional tone, ambience
- Quality markers: resolution, detail level, rendering quality

Output format: A single, flowing, optimized prompt using comma-separated descriptive phrases. Start with the most important subject, then style, then technical details. Include quality boosters at the end. Do NOT include explanatory text or labels — just the pure prompt.`

const USER_TEMPLATE = (count: number) =>
  count === 1
    ? `Analyze this reference image and generate the ultimate AI image generation prompt that would recreate it exactly. Be exhaustively detailed — capture every visual nuance, style element, lighting condition, and compositional choice.`
    : `Analyze these ${count} reference images and generate the ultimate AI image generation prompt. Identify the dominant visual style, composition principles, color palette, lighting setup, and key aesthetic elements consistent across all images.`

app.post('/api/analyze', upload.array('images', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[]
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No images provided' })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const imageContent: Anthropic.ImageBlockParam[] = files.map((file) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
        data: file.buffer.toString('base64'),
      },
    }))

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const stream = client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      thinking: { type: 'adaptive' } as any,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text', text: USER_TEMPLATE(files.length) },
          ],
        },
      ],
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`)
      }
    }

    const finalMessage = await stream.finalMessage()
    res.write(`data: ${JSON.stringify({ type: 'done', usage: finalMessage.usage })}\n\n`)
    res.end()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Analysis error:', message)
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`)
      res.end()
    } else {
      res.status(500).json({ error: message })
    }
  }
})

// ── Generate Image: Imagen 3 → Gemini 2.0 Flash fallback ──────────────────
//
// Imagen 3 (imagen-3.0-generate-002) is the highest quality model but
// requires explicit API access (waitlist for some accounts).
//
// Gemini 2.0 Flash Image Generation works with any standard AI Studio key
// and is used as automatic fallback.
//
// Get your free API key at: https://aistudio.google.com/app/apikey

interface PredictResponse {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
  error?: { message: string; code: number; status: string }
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
  if (!res.ok) {
    throw new Error(data.error?.message || `Imagen 3 error ${res.status}`)
  }

  const prediction = data.predictions?.[0]
  if (!prediction?.bytesBase64Encoded) throw new Error('No image from Imagen 3')

  return {
    base64: prediction.bytesBase64Encoded,
    mimeType: prediction.mimeType || 'image/png',
    model: 'Imagen 3',
  }
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
  if (!res.ok) {
    throw new Error(data.error?.message || `Gemini error ${res.status}`)
  }

  const parts = data.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'))
  if (!imagePart?.inlineData) throw new Error('No image from Gemini Flash')

  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType,
    model: 'Gemini 2.0 Flash',
  }
}

app.post('/api/generate', async (req: Request, res: Response) => {
  try {
    const { prompt, aspectRatio = '1:1' } = req.body as { prompt: string; aspectRatio?: string }

    if (!prompt?.trim()) {
      return res.status(400).json({ error: 'Prompt is required' })
    }
    if (!process.env.GOOGLE_AI_API_KEY) {
      return res.status(500).json({ error: 'GOOGLE_AI_API_KEY not configured' })
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY
    const trimmedPrompt = prompt.trim()

    // Try Imagen 3 first (best quality), fall back to Gemini 2.0 Flash
    let result: { base64: string; mimeType: string; model: string }
    try {
      result = await tryImagen3(trimmedPrompt, aspectRatio, apiKey)
      console.log('Generated with Imagen 3')
    } catch (imagen3Err) {
      console.warn('Imagen 3 unavailable, falling back to Gemini 2.0 Flash:', imagen3Err instanceof Error ? imagen3Err.message : imagen3Err)
      result = await tryGeminiFlash(trimmedPrompt, apiKey)
      console.log('Generated with Gemini 2.0 Flash')
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
})

export default app

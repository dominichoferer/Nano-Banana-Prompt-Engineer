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

const USER_TEMPLATE = (count: number, userDescription?: string) => {
  if (userDescription) {
    const plural = count > 1 ? `these ${count} reference images` : 'this reference image'
    return `Analyze ${plural} and extract its complete VISUAL IDENTITY: art style, color palette, lighting setup, mood, composition rules, texture quality, rendering technique, and any distinctive aesthetic elements.

Then, using that exact visual identity as the style foundation, create the ultimate AI image generation prompt for the following subject:
"${userDescription}"

The prompt must faithfully preserve all visual characteristics from the reference (lighting, color grading, style, mood, rendering quality) while generating the new subject. Make it clear in the prompt what visual style is being applied.

Output only the final prompt — no explanations, no labels, just the optimized comma-separated prompt.`
  }
  return count === 1
    ? `Analyze this reference image and generate the ultimate AI image generation prompt that would recreate it exactly. Be exhaustively detailed — capture every visual nuance, style element, lighting condition, and compositional choice. The prompt should be so precise that the generated image is virtually identical to the reference.`
    : `Analyze these ${count} reference images and generate the ultimate AI image generation prompt. Identify the dominant visual style, composition principles, color palette, lighting setup, and key aesthetic elements that are consistent across all images. Create a unified prompt that captures the essence and style of this image collection.`
}

app.post('/api/analyze', upload.array('images', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[]
    const userDescription = req.body?.userDescription as string | undefined

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
            { type: 'text', text: USER_TEMPLATE(files.length, userDescription) },
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

// ── Image Generation — Gemini 3 Pro ────────────────────────────────────────

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

// Ratios natively supported by Gemini imageGenerationConfig
const SUPPORTED_API_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4'])

// Resolution quality hints for prompt enrichment
const RESOLUTION_HINTS: Record<string, string> = {
  '1K': 'high quality',
  '2K': 'ultra high quality, 2K resolution',
  '4K': 'ultra HD, 4K, hyper-detailed, maximum quality, ultra sharp, high resolution',
}

app.post('/api/generate', async (req: Request, res: Response) => {
  try {
    const { prompt, aspectRatio, resolution } = req.body as {
      prompt: string
      aspectRatio?: string
      resolution?: string
    }

    if (!prompt?.trim()) {
      return res.status(400).json({ error: 'Prompt is required' })
    }
    if (!process.env.GOOGLE_AI_API_KEY) {
      return res.status(500).json({ error: 'GOOGLE_AI_API_KEY not configured' })
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY

    // Enrich prompt with resolution and unsupported aspect ratio hints
    const resHint = resolution ? RESOLUTION_HINTS[resolution] : null
    const nativeRatio = aspectRatio && SUPPORTED_API_RATIOS.has(aspectRatio)
    const ratioHint = aspectRatio && !nativeRatio ? `${aspectRatio} aspect ratio` : null

    const extras = [ratioHint, resHint].filter(Boolean).join(', ')
    const p = extras ? `${prompt.trim()}, ${extras}` : prompt.trim()

    // Build imageGenerationConfig only with supported parameters
    const imageGenerationConfig: Record<string, string> = {}
    if (nativeRatio && aspectRatio) imageGenerationConfig.aspectRatio = aspectRatio

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`
    const fetchRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: p }] }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          ...(Object.keys(imageGenerationConfig).length > 0 ? { imageGenerationConfig } : {}),
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
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Generation error:', message)
    res.status(500).json({ error: message })
  }
})

export default app

import type { Request, Response } from 'express'

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }
  }>
  error?: { message: string; code: number }
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>
  error?: { message: string; type?: string; code?: string }
}

type GenModel = 'pro' | 'openai'
type OpenAIFormat = 'png' | 'jpeg' | 'webp'

interface GenerateBody {
  prompt: string
  aspectRatio?: string
  resolution?: string
  model?: GenModel
  outputFormat?: OpenAIFormat
  referenceImages?: Array<{ mimeType: string; data: string }>
}

// ── Gemini config ───────────────────────────────────────────────────────────

const GEMINI_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4'])

const GEMINI_MODEL_ID = 'gemini-3-pro-image-preview'

const MODEL_LABELS: Record<GenModel, string> = {
  pro:    'Nano Banana Pro (Gemini 3)',
  openai: 'OpenAI gpt-image-2',
}

const QUALITY_HINT: Record<string, string> = {
  '1K': 'high quality, detailed',
  '2K': 'ultra high quality, 2K resolution, highly detailed, sharp',
  '4K': 'ultra HD, 4K resolution, hyper-detailed, maximum sharpness, professional quality, ultra sharp edges, rich textures',
}

// ── OpenAI config ───────────────────────────────────────────────────────────

// Official OpenAI sizes from the gpt-image-2 docs.
// No native 4K square — fall back to 2K for 1:1 4K.
// All edges multiples of 16, max edge ≤ 3840, total pixels 655,360–8,294,400.
const OPENAI_SIZES: Record<string, Record<string, string>> = {
  '1:1':  { '1K': '1024x1024', '2K': '2048x2048', '4K': '2048x2048' },
  '16:9': { '1K': '2048x1152', '2K': '2048x1152', '4K': '3840x2160' },
  '9:16': { '1K': '1152x2048', '2K': '1152x2048', '4K': '2160x3840' },
  '4:5':  { '1K': '1024x1280', '2K': '1632x2048', '4K': '2048x2560' },
  '5:4':  { '1K': '1280x1024', '2K': '2048x1632', '4K': '2560x2048' },
  '3:2':  { '1K': '1536x1024', '2K': '2048x1360', '4K': '3072x2048' },
  '2:3':  { '1K': '1024x1536', '2K': '1360x2048', '4K': '2048x3072' },
}

const OPENAI_QUALITY: Record<string, 'low' | 'medium' | 'high' | 'auto'> = {
  auto: 'auto',
  '1K': 'low',
  '2K': 'medium',
  '4K': 'high',
}

function openaiSize(ratio?: string, resolution?: string): string {
  if (resolution === 'auto') return 'auto'
  const r = ratio && OPENAI_SIZES[ratio] ? ratio : '1:1'
  const t = resolution && OPENAI_SIZES[r][resolution] ? resolution : '2K'
  return OPENAI_SIZES[r][t]
}

// ── OpenAI caller ───────────────────────────────────────────────────────────

async function callOpenAI(
  body: GenerateBody,
  signal: AbortSignal,
): Promise<{ image: string; prompt: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const size = openaiSize(body.aspectRatio, body.resolution)
  const quality = OPENAI_QUALITY[body.resolution ?? '2K'] ?? 'medium'
  const prompt = body.prompt.trim()
  const hasRefs = (body.referenceImages?.length ?? 0) > 0
  const outputFormat: OpenAIFormat = body.outputFormat ?? 'png'
  const responseMime = outputFormat === 'jpeg' ? 'image/jpeg' : `image/${outputFormat}`

  const headers = { Authorization: `Bearer ${apiKey}` }

  let fetchRes: globalThis.Response

  if (hasRefs) {
    // /v1/images/edits — multipart with reference image(s)
    const form = new FormData()
    form.append('model', 'gpt-image-2')
    form.append('prompt', prompt)
    form.append('size', size)
    form.append('quality', quality)
    form.append('output_format', outputFormat)
    form.append('n', '1')

    for (const [i, ref] of (body.referenceImages ?? []).entries()) {
      const bytes = Buffer.from(ref.data, 'base64')
      const blob = new Blob([new Uint8Array(bytes)], { type: ref.mimeType || 'image/jpeg' })
      const ext = (ref.mimeType?.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg')
      form.append('image[]', blob, `reference-${i + 1}.${ext}`)
    }

    fetchRes = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers,
      body: form,
      signal,
    })
  } else {
    // /v1/images/generations — JSON
    fetchRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt,
        size,
        quality,
        output_format: outputFormat,
        n: 1,
      }),
      signal,
    })
  }

  const data = await fetchRes.json() as OpenAIImageResponse
  if (!fetchRes.ok) {
    throw new Error(data.error?.message || `OpenAI error ${fetchRes.status}`)
  }

  const first = data.data?.[0]
  if (first?.b64_json) return { image: `data:${responseMime};base64,${first.b64_json}`, prompt }
  if (first?.url) return { image: first.url, prompt }
  throw new Error('No image returned from OpenAI')
}

// ── Gemini caller ───────────────────────────────────────────────────────────

async function callGemini(
  body: GenerateBody,
  signal: AbortSignal,
): Promise<{ image: string; prompt: string }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured')

  const qualityHint = body.resolution ? QUALITY_HINT[body.resolution] ?? '' : ''
  const isAutoRatio = body.aspectRatio === 'auto'
  const nativeRatio = !isAutoRatio && body.aspectRatio && GEMINI_RATIOS.has(body.aspectRatio)
  const ratioHint = !isAutoRatio && body.aspectRatio && !nativeRatio ? `, ${body.aspectRatio} aspect ratio` : ''
  const enrichedPrompt = [body.prompt.trim(), qualityHint, ratioHint].filter(Boolean).join(', ')

  const imageConfig: Record<string, string> = {}
  if (body.resolution === '4K') imageConfig.imageSize = '4K'
  else if (body.resolution === '2K') imageConfig.imageSize = '2K'
  if (nativeRatio && body.aspectRatio) imageConfig.aspectRatio = body.aspectRatio

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${apiKey}`

  const refParts = (body.referenceImages ?? []).map((img) => ({
    inlineData: { mimeType: img.mimeType, data: img.data },
  }))

  const fetchRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      contents: [{ parts: [...refParts, { text: enrichedPrompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
      },
    }),
  })

  const data = await fetchRes.json() as GeminiResponse
  if (!fetchRes.ok) throw new Error(data.error?.message || `Gemini API error ${fetchRes.status}`)

  const parts = data.candidates?.[0]?.content?.parts ?? []
  const img = parts.find((part) => part.inlineData?.mimeType?.startsWith('image/'))
  if (!img?.inlineData) throw new Error('No image returned from Gemini')

  return {
    image: `data:${img.inlineData.mimeType};base64,${img.inlineData.data}`,
    prompt: enrichedPrompt,
  }
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function generateImage(req: Request, res: Response) {
  try {
    const body = req.body as GenerateBody
    if (!body.prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' })

    const modelKey: GenModel = body.model === 'openai' ? 'openai' : 'pro'
    console.log(`[generate] model=${modelKey} resolution=${body.resolution} ratio=${body.aspectRatio}`)

    const abortController = new AbortController()
    const abortTimeout = setTimeout(() => abortController.abort(), 270_000)

    try {
      const result = modelKey === 'openai'
        ? await callOpenAI(body, abortController.signal)
        : await callGemini(body, abortController.signal)

      res.json({
        image: result.image,
        prompt: result.prompt,
        model: MODEL_LABELS[modelKey],
      })
    } finally {
      clearTimeout(abortTimeout)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[generate] error:', message)
    res.status(500).json({ error: message })
  }
}

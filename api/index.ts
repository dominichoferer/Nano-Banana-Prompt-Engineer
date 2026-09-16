import express from 'express'
import cors from 'cors'
import multer from 'multer'
import type { Request, Response } from 'express'
import { mountAuthRoutes, requireAuth } from '../server/auth.js'
import { holeBild } from '../server/bildholen.js'
import { analyzeImages } from '../server/analyze.js'

const app = express()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase()
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf']
    cb(null, allowed.includes(file.mimetype) || allowedExts.includes(ext))
  },
})

app.use(cors())
app.use(express.json({ limit: '100mb' }))

// Auth endpoints (login/logout/me) — no-op if AUTH_USERS env not set
mountAuthRoutes(app)

// ── Analyse ─────────────────────────────────────────────────────────────────
//
// Hier stand bis eben eine zweite, vollständige Kopie des Prompt-Schreibers:
// eigener System-Prompt, eigene Bildindex- und Rollenbausteine, eigener
// Aufruf. Zwei Fassungen desselben Verfahrens laufen unweigerlich
// auseinander — und weil DIESE hier im Betrieb läuft, hätte die Seite still
// anders gearbeitet als die lokale. Jetzt gibt es nur noch eine Fassung, in
// server/analyze.ts.
app.post('/api/analyze', requireAuth, upload.array('images', 10), analyzeImages)

// ── Generate endpoint (Gemini + OpenAI image generation) ────────────────────

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

type GenModel = 'flare' | 'sunburst' | 'openai' | 'pro' | 'flash'
type OpenAIFormat = 'auto' | 'png' | 'jpeg' | 'webp'

interface GenerateBody {
  prompt: string
  aspectRatio?: string
  resolution?: string
  model?: GenModel
  outputFormat?: OpenAIFormat
  /** Freigestellt ausgeben. Können nur die gpt-image-2.5-Modelle. */
  transparent?: boolean
  referenceImages?: Array<{ mimeType: string; data: string }>
}

const GEMINI_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4'])

const GEMINI_MODEL_IDS: Record<'pro' | 'flash', string> = {
  pro:   'gemini-3-pro-image',     // Nano Banana Pro (nicht mehr -preview)
  flash: 'gemini-3.1-flash-image', // Nano Banana 2
}

// Die Modellkennungen, wie sie im Feld `model` der OpenAI-Bild-API stehen.
const OPENAI_MODEL_IDS: Record<'openai' | 'flare' | 'sunburst', string> = {
  openai:   'gpt-image-2',
  flare:    'gpt-image-2.5-flare',
  sunburst: 'gpt-image-2.5-sunburst',
}

type OpenAIKey = keyof typeof OPENAI_MODEL_IDS

function istOpenAI(m: GenModel): m is OpenAIKey {
  return m === 'openai' || m === 'flare' || m === 'sunburst'
}

const MODEL_LABELS: Record<GenModel, string> = {
  pro:      'Nano Banana Pro (Gemini 3 Pro)',
  flash:    'Nano Banana 2 (Gemini 3.1 Flash)',
  openai:   'ChatGPT Image (gpt-image-2)',
  flare:    'GPT Image 2.5 Flare',
  sunburst: 'GPT Image 2.5 Sunburst',
}

const QUALITY_HINT: Record<string, string> = {
  '1K': 'high quality, detailed',
  '2K': 'ultra high quality, 2K resolution, highly detailed, sharp',
  '4K': 'ultra HD, 4K resolution, hyper-detailed, maximum sharpness, professional quality, ultra sharp edges, rich textures',
}

// gpt-image-2 sizes — both edges divisible by 16, max edge ≤3840, ≤8.3MP total.
const OPENAI_SIZES: Record<string, Record<'1K' | '2K' | '4K', string>> = {
  '1:1':  { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' },
  '16:9': { '1K': '1280x720',  '2K': '2048x1152', '4K': '3840x2160' },
  '9:16': { '1K': '720x1280',  '2K': '1152x2048', '4K': '2160x3840' },
  '4:3':  { '1K': '1024x768',  '2K': '2048x1536', '4K': '2880x2160' },
  '3:4':  { '1K': '768x1024',  '2K': '1536x2048', '4K': '2160x2880' },
  '3:2':  { '1K': '1536x1024', '2K': '2304x1536', '4K': '3072x2048' },
  '2:3':  { '1K': '1024x1536', '2K': '1536x2304', '4K': '2048x3072' },
  '4:5':  { '1K': '1024x1280', '2K': '1536x1920', '4K': '2304x2880' },
  '5:4':  { '1K': '1280x1024', '2K': '1920x1536', '4K': '2880x2304' },
}

const OPENAI_QUALITY: Record<string, 'low' | 'medium' | 'high' | 'auto'> = {
  auto: 'auto', '1K': 'low', '2K': 'medium', '4K': 'high',
}

function openaiSize(ratio?: string, resolution?: string): string {
  if (ratio === 'auto' && (resolution === 'auto' || !resolution)) return 'auto'
  const r = (!ratio || ratio === 'auto') ? '1:1'
    : (OPENAI_SIZES[ratio] ? ratio : '1:1')
  const tier: '1K' | '2K' | '4K' =
    resolution === '1K' || resolution === '2K' || resolution === '4K' ? resolution : '2K'
  return OPENAI_SIZES[r][tier]
}

function detectMime(b64: string): string {
  const head = Buffer.from(b64.slice(0, 24), 'base64').subarray(0, 12)
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'image/webp'
  return 'image/png'
}

async function callOpenAI(
  body: GenerateBody,
  signal: AbortSignal,
  modelKey: OpenAIKey,
): Promise<{ image: string; prompt: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const modelId = OPENAI_MODEL_IDS[modelKey]
  const size = openaiSize(body.aspectRatio, body.resolution)
  const quality = OPENAI_QUALITY[body.resolution ?? '2K'] ?? 'medium'
  const prompt = body.prompt.trim()
  const hasRefs = (body.referenceImages?.length ?? 0) > 0
  // Freistellen kann nur gpt-image-2.5, und nur in ein Format mit Alphakanal.
  // JPEG kennt keine Transparenz — dort würde der Wunsch stillschweigend
  // verpuffen, deshalb wird auf PNG gewechselt statt ihn zu ignorieren.
  const transparent = Boolean(body.transparent) && (modelKey === 'flare' || modelKey === 'sunburst')
  const outputFormat: OpenAIFormat = transparent
    ? (body.outputFormat === 'webp' ? 'webp' : 'png')
    : (body.outputFormat ?? 'auto')
  console.log(`[openai] model=${modelId} ratio=${body.aspectRatio} resolution=${body.resolution} → size=${size} quality=${quality} format=${outputFormat} transparent=${transparent} hasRefs=${hasRefs}`)

  const headers = { Authorization: `Bearer ${apiKey}` }

  let fetchRes: globalThis.Response

  if (hasRefs) {
    const form = new FormData()
    form.append('model', modelId)
    form.append('prompt', prompt)
    form.append('size', size)
    form.append('quality', quality)
    if (outputFormat !== 'auto') form.append('output_format', outputFormat)
    if (transparent) form.append('background', 'transparent')
    form.append('n', '1')
    for (const [i, ref] of (body.referenceImages ?? []).entries()) {
      const bytes = Buffer.from(ref.data, 'base64')
      const blob = new Blob([new Uint8Array(bytes)], { type: ref.mimeType || 'image/jpeg' })
      const ext = (ref.mimeType?.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg')
      form.append('image[]', blob, `reference-${i + 1}.${ext}`)
    }
    fetchRes = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers, body: form, signal,
    })
  } else {
    fetchRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId, prompt, size, quality,
        ...(outputFormat !== 'auto' ? { output_format: outputFormat } : {}),
        ...(transparent ? { background: 'transparent' } : {}),
        n: 1,
      }),
      signal,
    })
  }

  const data = await fetchRes.json() as OpenAIImageResponse
  if (!fetchRes.ok) throw new Error(data.error?.message || `OpenAI error ${fetchRes.status}`)

  const first = data.data?.[0]
  if (first?.b64_json) {
    const mime = detectMime(first.b64_json)
    return { image: `data:${mime};base64,${first.b64_json}`, prompt }
  }
  if (first?.url) return { image: first.url, prompt }
  throw new Error('No image returned from OpenAI')
}

async function callGemini(
  body: GenerateBody,
  signal: AbortSignal,
  modelKey: 'pro' | 'flash',
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_IDS[modelKey]}:generateContent?key=${apiKey}`
  const fetchRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      contents: [{ parts: [
        ...(body.referenceImages ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
        { text: enrichedPrompt },
      ] }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
      },
    }),
  })
  const data = await fetchRes.json() as GeminiResponse
  if (!fetchRes.ok) throw new Error(data.error?.message || `Gemini error ${fetchRes.status}`)

  const parts = data.candidates?.[0]?.content?.parts ?? []
  const img = parts.find((part) => part.inlineData?.mimeType?.startsWith('image/'))
  if (!img?.inlineData) throw new Error('No image returned from Gemini')

  return {
    image: `data:${img.inlineData.mimeType};base64,${img.inlineData.data}`,
    prompt: enrichedPrompt,
  }
}

// Bild von einer Adresse holen — für das Einfügen aus dem Browser, wenn in der
// Zwischenablage nur ein Verweis statt eines Bildes liegt.
app.post('/api/bild-holen', requireAuth, holeBild)

app.post('/api/generate', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as GenerateBody
    if (!body.prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' })

    // Unbekanntes fällt ausdrücklich auf die Voreinstellung zurück. Wichtig:
    // Die Liste muss jedes gültige Modell nennen — stand hier ein Name nicht
    // drin, landete er stillschweigend bei Gemini und der Nutzer bekam ein Bild
    // (und eine Rechnung) vom falschen Anbieter, ohne dass irgendwo ein Fehler
    // auftauchte. Kommt ein Modell dazu, gehört es HIER hinein.
    const ALLE_MODELLE: GenModel[] = ['flare', 'sunburst', 'openai', 'pro', 'flash']
    const gewuenscht = body.model as GenModel | undefined
    const modelKey: GenModel = ALLE_MODELLE.includes(gewuenscht as GenModel)
      ? (gewuenscht as GenModel)
      : 'flare'
    if (gewuenscht && gewuenscht !== modelKey) {
      console.warn(`[generate] unbekanntes Modell "${gewuenscht}" — Rückfall auf ${modelKey}`)
    }
    const abortController = new AbortController()
    const abortTimeout = setTimeout(() => abortController.abort(), 270_000)

    try {
      const result = istOpenAI(modelKey)
        ? await callOpenAI(body, abortController.signal, modelKey)
        : await callGemini(body, abortController.signal, modelKey)

      res.json({ image: result.image, prompt: result.prompt, model: MODEL_LABELS[modelKey] })
    } finally {
      clearTimeout(abortTimeout)
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

export default app

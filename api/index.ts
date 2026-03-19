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

// ── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an elite AI image prompt engineer specializing in creating structured, ultra-detailed prompts for AI image generation and photo retouching tools (Nano Banana Pro, Midjourney, DALL-E, Stable Diffusion, Flux).

You analyze reference images with extreme precision and generate prompts in a specific structured format using section dividers, warning markers, and imperative instructions.

═══════════════════════════════════════════
OUTPUT FORMAT RULES
═══════════════════════════════════════════

1. HEADER LINE
   Start with a clear declaration of the job type AND a reference index:
   — PHOTO RETOUCH: "USE THE UPLOADED PHOTO(S) AS STRICT REFERENCE BASE.\nTHIS IS A PHOTO RETOUCH — NOT A NEW IMAGE GENERATION."
   — NEW GENERATION: "USE THE UPLOADED PHOTO(S) AS VISUAL STYLE REFERENCE.\nTHIS IS A NEW IMAGE GENERATION INSPIRED BY THE REFERENCE(S)."

   If multiple images are provided, always add an IMAGE INDEX section directly after the header:
   IMAGE INDEX
   ═══════════════════════════════════════════
   — IMAGE 1 — [filename]: [brief 1-line description of what is in this image]
   — IMAGE 2 — [filename]: [brief 1-line description]
   (This tells the downstream AI tool which image number is which.)

2. USE ═══════════════════════════════════════════ as section dividers (exactly this length)

3. SUBJECT LOCK SECTION (include when the request requires preserving a non-face subject — a body silhouette, object, or product)
   Format:
   📐 SUBJECT LOCK — PROPORTIONS & COMPOSITION ⚠️
   ═══════════════════════════════════════════
   Specify which IMAGE number this applies to.
   Describe EXACTLY: overall dimensions and aspect ratio, body/object silhouette, spatial position in frame, structural features that must not change.
   End with: "Do NOT alter the proportions, silhouette, or overall composition of the main subject."

4. FACE LOCK SECTION (include whenever people are present and face preservation is required)
   Format:
   ⚠️ FACE LOCK — ABSOLUTE PRIORITY RULE ⚠️
   ═══════════════════════════════════════════
   Specify which IMAGE number each person comes from (e.g., "PERSON from IMAGE 1 — left side:").
   Then list pixel-perfect preservation rules for EACH person detected.
   Describe EXACTLY: facial contours, eye shape/color/spacing, nose, lips, skin tone, skin texture, hair (color, highlights, texture, how it falls), age appearance, eyebrows.
   End with: "If the faces are not 100% identical to the reference, the result is wrong."

5. SUBJECT DESCRIPTIONS
   For each person use: PERSON NAME or POSITION (left/right/center) + which IMAGE they come from
   Describe: hair, skin tone, clothing (every item with color, material, brand if visible), accessories, shoes.
   End each person's section with: "FACE UNCHANGED."

6. POSE & POSITIONING SECTION
   Format header: ——— POSE CORRECTIONS ———
   Be numerically precise: "10 degrees", "5cm gap", "45° angle"
   Describe: spacing, body angles, posture details (spine, shoulders, chest, chin), expressions, what they're holding or doing.

7. LIGHTING SECTION
   Format header: 📸 PERFECT PHOTOGRAPHIC LIGHTING & COLOR
   Include:
   — Camera: brand, model, lens, aperture, ISO, shutter speed
   — KEY LIGHT: position, type, angle, quality description
   — FILL LIGHT: position, power ratio, effect
   — RIM / HAIR LIGHT: position, effect
   — EYE CATCHLIGHTS: description (always include this for portraits)
   — SKIN RETOUCHING: style (editorial, frequency separation, etc.)

8. COLOR GRADING SECTION
   Include:
   — Overall tone
   — Whites / Shadows treatment
   — Skin tone quality
   — Contrast style
   — Reference publications or brands (e.g. "Kinfolk Magazine", "Monocle editorial", "high-end brand campaign")
   — What to AVOID (no Instagram filters, no oversaturation, no cool blue tones, etc.)

9. BACKGROUND
   Describe exact background replacement or enhancement.
   If background comes from a specific image, reference it: "USE BACKGROUND FROM IMAGE 2 exactly as captured."
   Include: shadows, reflections, environment details.

10. OUTPUT SPECS
   Resolution (8K default for retouching), quality requirements, zero-artifacts rule.

11. FINAL ENFORCEMENT RULE
    One clear, strong closing rule that reinforces the most critical requirement.
    Always end with the image index reminder: "When in doubt, refer to IMAGE 1/2/3 as indexed above."

═══════════════════════════════════════════
WRITING STYLE RULES
═══════════════════════════════════════════
— Write in direct imperative style ("Preserve exactly:" not "The AI should preserve:")
— Use em dashes (—) for list items within sections
— Use CAPS for section headers and critical keywords
— Be exhaustively specific — real camera brands, real measurement values, real publication names
— Never use vague terms — replace "good lighting" with "large octabox softbox positioned 45° camera-left"
— All prompts must be in English
— Do NOT add explanations, preamble, or commentary — output the prompt directly
— ALWAYS reference images by their number (IMAGE 1, IMAGE 2, etc.) throughout the prompt`

// ── User template ───────────────────────────────────────────────────────────

interface ImageSetting {
  name: string
  faceLock: boolean
  objectLock: boolean
  customLock: string
}

const CHANGE_MAP: Record<string, string> = {
  pose:       'POSE & POSITIONING section — required body alignment, spacing, angles, expression corrections',
  lighting:   'LIGHTING section — camera specs, key/fill/rim lights, catchlights, required improvements',
  color:      'COLOR GRADING section — tone, shadows, whites, contrast adjustments',
  background: 'BACKGROUND section — exact replacement or enhancement description',
}

function buildImageIndex(settings: ImageSetting[]): string {
  return settings.map((s, i) => `— IMAGE ${i + 1} — "${s.name}"`).join('\n')
}

function buildPerImageLocks(settings: ImageSetting[]): string {
  const blocks: string[] = []
  settings.forEach((s, i) => {
    const num = i + 1
    const lines: string[] = []
    if (s.faceLock) {
      lines.push(
        `— ⚠️ FACE LOCK (IMAGE ${num}): Preserve ALL facial features with pixel-perfect accuracy — ` +
        `face shape, eye color/shape/spacing, nose bridge, lip shape/thickness, skin tone, ` +
        `skin texture/pores, hair color/highlights/texture/fall, eyebrows shape/color, age appearance. ` +
        `DO NOT alter a single facial feature from IMAGE ${num}.`,
      )
    }
    if (s.objectLock) {
      lines.push(
        `— ⚠️ OBJECT/PROPORTION LOCK (IMAGE ${num}): Preserve exact silhouette, body proportions, ` +
        `spatial positioning in frame, and overall composition from IMAGE ${num}. ` +
        `DO NOT resize, morph, recompose, or restructure the subject.`,
      )
    }
    if (s.customLock) {
      lines.push(
        `— 🔒 CUSTOM LOCK (IMAGE ${num}): Preserve EXACTLY — "${s.customLock}". ` +
        `This element must appear in the output identical to IMAGE ${num}. No exceptions.`,
      )
    }
    if (lines.length > 0) {
      blocks.push(`IMAGE ${num} — "${s.name}":\n${lines.join('\n')}`)
    }
  })
  return blocks.join('\n\n')
}

function buildUserMessage(
  imageSettings: ImageSetting[],
  userDescription?: string,
  promptMode?: string,
  changeAreas?: string[],
): string {
  const count = imageSettings.length
  const isGeneration = promptMode === 'generation'
  const hasChange = (changeAreas?.length ?? 0) > 0
  const imageIndexBlock = buildImageIndex(imageSettings)
  const perImageLocksBlock = buildPerImageLocks(imageSettings)
  const hasAnyLocks = imageSettings.some((s) => s.faceLock || s.objectLock || s.customLock)

  const imageRefSection = count > 0
    ? `═══════════════════════════════════════════
UPLOADED IMAGES — REFERENCE INDEX
═══════════════════════════════════════════
${imageIndexBlock}

The images are attached above in this EXACT ORDER (IMAGE 1 = first attached image, IMAGE 2 = second, etc.).
When you reference a subject, face, background, or any element in the prompt — ALWAYS specify which IMAGE number it comes from.`
    : ''

  if (isGeneration) {
    const subject = userDescription?.trim()
      ? `Generate the following subject/scene:\n"${userDescription.trim()}"`
      : `Generate an original creative image.`

    const refBlock = count > 0
      ? `\n\n${imageRefSection}\n\nAnalyze all ${count} image(s): extract art style, color palette, lighting, mood, composition, texture and rendering technique from each.\nSpecify in the prompt which visual elements come from which IMAGE number.`
      : ''

    return `THIS IS A NEW IMAGE GENERATION — CREATE FROM SCRATCH based on the description below.${refBlock}

${subject}

Generate a highly detailed, structured prompt for AI image generation.
Be specific about: subject, style, lighting, color palette, mood, composition, camera settings, post-processing.
Start directly with the header line — no preamble.`
  }

  const locksSection = hasAnyLocks
    ? `\n\n═══════════════════════════════════════════
PER-IMAGE LOCK RULES — ABSOLUTE PRIORITY
═══════════════════════════════════════════
These rules OVERRIDE everything else. Treat them as hard constraints.

${perImageLocksBlock}`
    : ''

  const changeSection = hasChange
    ? `\n\n═══════════════════════════════════════════
GLOBAL CHANGES REQUESTED
═══════════════════════════════════════════
✏️ Modify ONLY these aspects (apply globally unless user specifies an image):
${changeAreas!.map((f) => `— ${CHANGE_MAP[f] ?? f}`).join('\n')}`
    : ''

  const userBlock = userDescription?.trim()
    ? `\n\n═══════════════════════════════════════════
USER'S INTENT
═══════════════════════════════════════════
"${userDescription.trim()}"

When the user references "Bild 1" / "Image 1" / "the first image" — this means IMAGE 1 from the index above.
When the user references "Bild 2" / "Image 2" / "the second image" — this means IMAGE 2, etc.`
    : ''

  const instruction = !hasAnyLocks && !hasChange && !userDescription?.trim()
    ? `\n\nPerfectly retouch and enhance all images while preserving every detail of the originals.`
    : ''

  return `USE THE UPLOADED PHOTO(S) AS STRICT REFERENCE BASE.
THIS IS A PHOTO RETOUCH — NOT A NEW IMAGE GENERATION.

${imageRefSection}${locksSection}${changeSection}${userBlock}${instruction}

═══════════════════════════════════════════
TASK
═══════════════════════════════════════════
Analyze all ${count} uploaded image(s) carefully, respecting all per-image lock rules above.
Generate the structured prompt NOW following the format from your system instructions.
Reference images by their IMAGE NUMBER (IMAGE 1, IMAGE 2, etc.) throughout every section of the prompt.
Start directly with the header line — no preamble.`
}

// ── Analyze endpoint ────────────────────────────────────────────────────────

app.post('/api/analyze', upload.array('images', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[]
    const userDescription = req.body?.userDescription as string | undefined
    const promptMode = req.body?.promptMode as string | undefined
    const changeAreasRaw = req.body?.changeAreas as string | undefined
    const changeAreas = changeAreasRaw ? changeAreasRaw.split(',').filter(Boolean) : []

    // Parse per-image settings
    let imageSettings: ImageSetting[] = []
    try {
      const raw = req.body?.imageSettings as string | undefined
      if (raw) imageSettings = JSON.parse(raw)
    } catch { /* ignore */ }

    if ((!files || files.length === 0) && promptMode !== 'generation') {
      return res.status(400).json({ error: 'No images provided' })
    }

    // Ensure imageSettings aligns with files
    if (imageSettings.length !== files.length) {
      imageSettings = files.map((f) => ({
        name: f.originalname || f.fieldname,
        faceLock: false,
        objectLock: false,
        customLock: '',
      }))
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
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            {
              type: 'text',
              text: buildUserMessage(imageSettings, userDescription, promptMode, changeAreas),
            },
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

// ── Generate endpoint (Gemini image generation) ─────────────────────────────

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }
  }>
  error?: { message: string; code: number }
}

const SUPPORTED_API_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4'])

const RESOLUTION_CONFIG: Record<string, { hint: string }> = {
  '1K': { hint: 'high quality, 1024px' },
  '2K': { hint: 'ultra high quality, 2K, 2048px' },
  '4K': { hint: 'ultra HD, 4K, 4096px, hyper-detailed, maximum quality, ultra sharp' },
}

app.post('/api/generate', async (req: Request, res: Response) => {
  try {
    const { prompt, aspectRatio, resolution } = req.body as {
      prompt: string
      aspectRatio?: string
      resolution?: string
    }
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' })
    if (!process.env.GOOGLE_AI_API_KEY) return res.status(500).json({ error: 'GOOGLE_AI_API_KEY not configured' })

    const apiKey = process.env.GOOGLE_AI_API_KEY
    const resHint = resolution ? `, ${RESOLUTION_CONFIG[resolution]?.hint ?? ''}` : ''
    const nativeRatio = aspectRatio && SUPPORTED_API_RATIOS.has(aspectRatio)
    const ratioHint = aspectRatio && !nativeRatio ? `, ${aspectRatio} aspect ratio` : ''
    const p = `${prompt.trim()}${ratioHint}${resHint}`.trim()

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
          ...(Object.keys(imageGenerationConfig).length > 0 ? { imageGenerationConfig } : {}),
        },
      }),
    })
    const data = await fetchRes.json() as GeminiResponse
    if (!fetchRes.ok) throw new Error(data.error?.message || `Gemini error ${fetchRes.status}`)

    const parts = data.candidates?.[0]?.content?.parts ?? []
    const img = parts.find((part) => part.inlineData?.mimeType?.startsWith('image/'))
    if (!img?.inlineData) throw new Error('No image returned from Gemini')

    res.json({
      image: `data:${img.inlineData.mimeType};base64,${img.inlineData.data}`,
      prompt: p,
      model: 'Gemini 2.0 Flash',
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

export default app

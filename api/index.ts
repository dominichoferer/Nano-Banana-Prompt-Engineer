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
   Start with a clear declaration of the job type:
   — PHOTO RETOUCH: "USE THE UPLOADED PHOTO AS STRICT REFERENCE BASE.\nTHIS IS A PHOTO RETOUCH — NOT A NEW IMAGE GENERATION."
   — NEW GENERATION: "USE THE UPLOADED PHOTO AS VISUAL STYLE REFERENCE.\nTHIS IS A NEW IMAGE GENERATION INSPIRED BY THE REFERENCE."

2. USE ═══════════════════════════════════════════ as section dividers (exactly this length)

3. FACE LOCK SECTION (include whenever people are present in the image)
   Format:
   ⚠️ FACE LOCK — ABSOLUTE PRIORITY RULE ⚠️
   ═══════════════════════════════════════════
   Then list pixel-perfect preservation rules for EACH person detected.
   Describe EXACTLY: facial contours, eye shape/color/spacing, nose, lips, skin tone, skin texture, hair (color, highlights, texture, how it falls), age appearance, eyebrows.
   End with: "If the faces are not 100% identical to the reference, the result is wrong."

4. SUBJECT DESCRIPTIONS
   For each person use: PERSON NAME or POSITION (left/right/center)
   Describe: hair, skin tone, clothing (every item with color, material, brand if visible), accessories, shoes.
   End each person's section with: "FACE UNCHANGED."

5. POSE & POSITIONING SECTION
   Format header: ——— POSE CORRECTIONS ———
   Be numerically precise: "10 degrees", "5cm gap", "45° angle"
   Describe: spacing, body angles, posture details (spine, shoulders, chest, chin), expressions, what they're holding or doing.

6. LIGHTING SECTION
   Format header: 📸 PERFECT PHOTOGRAPHIC LIGHTING & COLOR
   Include:
   — Camera: brand, model, lens, aperture, ISO, shutter speed
   — KEY LIGHT: position, type, angle, quality description
   — FILL LIGHT: position, power ratio, effect
   — RIM / HAIR LIGHT: position, effect
   — EYE CATCHLIGHTS: description (always include this for portraits)
   — SKIN RETOUCHING: style (editorial, frequency separation, etc.)

7. COLOR GRADING SECTION
   Include:
   — Overall tone
   — Whites / Shadows treatment
   — Skin tone quality
   — Contrast style
   — Reference publications or brands (e.g. "Kinfolk Magazine", "Monocle editorial", "high-end brand campaign")
   — What to AVOID (no Instagram filters, no oversaturation, no cool blue tones, etc.)

8. BACKGROUND
   Describe exact background replacement or enhancement.
   Include: shadows, reflections, environment details.

9. OUTPUT SPECS
   Resolution (8K default for retouching), quality requirements, zero-artifacts rule.

10. FINAL ENFORCEMENT RULE
    One clear, strong closing rule that reinforces the most critical requirement.

═══════════════════════════════════════════
WRITING STYLE RULES
═══════════════════════════════════════════
— Write in direct imperative style ("Preserve exactly:" not "The AI should preserve:")
— Use em dashes (—) for list items within sections
— Use CAPS for section headers and critical keywords
— Be exhaustively specific — real camera brands, real measurement values, real publication names
— Never use vague terms — replace "good lighting" with "large octabox softbox positioned 45° camera-left"
— All prompts must be in English
— Do NOT add explanations, preamble, or commentary — output the prompt directly`

// ── User template ───────────────────────────────────────────────────────────

function buildUserMessage(count: number, userDescription?: string, promptMode?: string): string {
  const isRetouch = promptMode !== 'generation'
  const modeLabel = isRetouch ? 'PHOTO RETOUCH' : 'NEW GENERATION'
  const imageRef = count > 1 ? `these ${count} reference images` : 'this reference image'

  const changeBlock = userDescription
    ? `\n\nUSER'S REQUESTED CHANGES / INTENT:\n"${userDescription}"\n\nAnalyze the reference image, then incorporate these changes into the structured prompt. Preserve everything from the reference that is NOT explicitly changed.`
    : `\n\nGenerate a prompt to ${isRetouch ? 'perfectly retouch and enhance this image' : 'create a new image inspired by the visual style and composition of this reference'}.`

  return `Analyze ${imageRef} in extreme detail for a ${modeLabel} job.${changeBlock}

ANALYSIS CHECKLIST — extract all of these from the reference image:
— Count and position every person present
— For each person: complete facial feature description, hair, skin tone, every clothing item with exact colors and materials, accessories, footwear
— Current pose: body alignment, spacing between subjects, posture quality, angles, hand/arm positions, expressions
— Current lighting: quality, direction, shadows, catchlights present
— Current background: what it is, what it should become
— Current color grading: tone, warmth/coolness, contrast

OUTPUT: Generate the complete structured prompt NOW, following the format from your system instructions exactly. Start directly with the header line — no preamble.`
}

// ── Analyze endpoint ────────────────────────────────────────────────────────

app.post('/api/analyze', upload.array('images', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[]
    const userDescription = req.body?.userDescription as string | undefined
    const promptMode = req.body?.promptMode as string | undefined

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
      max_tokens: 4096,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      thinking: { type: 'adaptive' } as any,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            {
              type: 'text',
              text: buildUserMessage(files.length, userDescription, promptMode),
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

export default app

import Anthropic from '@anthropic-ai/sdk'
import type { Request, Response } from 'express'

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

3. SUBJECT LOCK SECTION (include when the request requires preserving a non-face subject — a body silhouette, object, or product)
   Format:
   📐 SUBJECT LOCK — PROPORTIONS & COMPOSITION ⚠️
   ═══════════════════════════════════════════
   Describe EXACTLY: overall dimensions and aspect ratio, body/object silhouette, spatial position in frame, structural features that must not change.
   End with: "Do NOT alter the proportions, silhouette, or overall composition of the main subject."

4. FACE LOCK SECTION (include whenever people are present and face preservation is required)
   Format:
   ⚠️ FACE LOCK — ABSOLUTE PRIORITY RULE ⚠️
   ═══════════════════════════════════════════
   Then list pixel-perfect preservation rules for EACH person detected.
   Describe EXACTLY: facial contours, eye shape/color/spacing, nose, lips, skin tone, skin texture, hair (color, highlights, texture, how it falls), age appearance, eyebrows.
   End with: "If the faces are not 100% identical to the reference, the result is wrong."

5. SUBJECT DESCRIPTIONS
   For each person use: PERSON NAME or POSITION (left/right/center)
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
   Include: shadows, reflections, environment details.

10. OUTPUT SPECS
   Resolution (8K default for retouching), quality requirements, zero-artifacts rule.

11. FINAL ENFORCEMENT RULE
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

const LOCK_MAP: Record<string, string> = {
  subject:  'SUBJECT LOCK section — preserve exact proportions, silhouette, shape and overall composition; no morphing, resizing, or restructuring',
  face:     'FACE LOCK section — pixel-perfect facial feature preservation for every person present',
  skin:     'SKIN LOCK section — preserve exact skin tone, texture, pores, body characteristics unchanged',
  clothing: 'CLOTHING LOCK section — preserve every clothing item, color, material, fit and accessories exactly',
}

const CHANGE_MAP: Record<string, string> = {
  pose:       'POSE & POSITIONING section — required body alignment, spacing, angles, expression corrections',
  lighting:   'LIGHTING section — camera specs, key/fill/rim lights, catchlights, required improvements',
  color:      'COLOR GRADING section — tone, shadows, whites, contrast adjustments',
  background: 'BACKGROUND section — exact replacement or enhancement description',
}

const ANALYSIS_MAP: Record<string, string> = {
  subject:    'Overall proportions, silhouette, shape and spatial composition of the main subject',
  face:       'Facial features of every person (shape, color, texture, hair, eyebrows)',
  skin:       'Skin tone, texture quality, body characteristics',
  clothing:   'All clothing items, colors, materials, fit, accessories, footwear',
  pose:       'Body alignment, spacing, posture, angles, hand/arm positions, expressions',
  lighting:   'Lighting quality, direction, shadows, catchlights',
  color:      'Color grading, tone, warmth/coolness, contrast',
  background: 'Background content and what needs to change',
}

function buildUserMessage(
  count: number,
  userDescription?: string,
  promptMode?: string,
  lockAreas?: string[],
  changeAreas?: string[],
): string {
  const isGeneration = promptMode === 'generation'
  const imageRef = count > 1 ? `these ${count} reference images` : 'this reference image'
  const hasLock = (lockAreas?.length ?? 0) > 0
  const hasChange = (changeAreas?.length ?? 0) > 0
  const hasSelections = hasLock || hasChange

  if (isGeneration) {
    const subject = userDescription?.trim()
      ? `\n\nGenerate the following subject using the visual style of the reference:\n"${userDescription.trim()}"`
      : `\n\nExtract the complete visual identity and generate a new image in the same style.`
    return `USE THE UPLOADED PHOTO AS VISUAL STYLE REFERENCE.
THIS IS A NEW IMAGE GENERATION INSPIRED BY THE REFERENCE.
${subject}

Analyze ${imageRef}: extract art style, color palette, lighting, mood, composition, texture and rendering technique.
Then generate a structured prompt that recreates those visual characteristics for the new subject.
Start directly with the header line — no preamble.`
  }

  if (!hasSelections) {
    const instruction = userDescription?.trim()
      ? `Apply ONLY the following change — everything else stays exactly as in the reference:\n"${userDescription.trim()}"`
      : `Perfectly retouch and enhance this image while preserving every detail of the original.`
    return `USE THE UPLOADED PHOTO AS STRICT REFERENCE BASE.
THIS IS A PHOTO RETOUCH — NOT A NEW IMAGE GENERATION.

${instruction}

Analyze ${imageRef} and generate a concise, targeted structured prompt.
Include only the header line, the specific change instructions, and OUTPUT SPECS.
Start directly with the header line — no preamble.`
  }

  const allAreas = [...(lockAreas ?? []), ...(changeAreas ?? [])]

  const lockBlock = hasLock
    ? `\n\n🔒 LOCK — Preserve these sections EXACTLY from the reference:\n${lockAreas!.map((f) => `— ${LOCK_MAP[f] ?? f}`).join('\n')}`
    : ''

  const changeBlock = hasChange
    ? `\n\n✏️ CHANGE — Only modify these sections (incorporate user intent below):\n${changeAreas!.map((f) => `— ${CHANGE_MAP[f] ?? f}`).join('\n')}`
    : ''

  const userBlock = userDescription?.trim()
    ? `\n\nUSER'S INTENT:\n"${userDescription.trim()}"`
    : ''

  const checklistItems = allAreas.map((f) => ANALYSIS_MAP[f] ?? f)

  return `Analyze ${imageRef} for a targeted PHOTO RETOUCH job.${lockBlock}${changeBlock}${userBlock}

ANALYSIS CHECKLIST — extract these from the reference:
${checklistItems.map((i) => `— ${i}`).join('\n')}

OUTPUT: Generate the focused structured prompt NOW, following the format from your system instructions.
Include ONLY the sections listed above (lock + change). Always include the header line and OUTPUT SPECS. Start directly — no preamble.`
}

export async function analyzeImages(req: Request, res: Response) {
  try {
    const files = req.files as Express.Multer.File[]
    const userDescription = req.body?.userDescription as string | undefined
    const promptMode = req.body?.promptMode as string | undefined
    const lockAreasRaw = req.body?.lockAreas as string | undefined
    const changeAreasRaw = req.body?.changeAreas as string | undefined
    const lockAreas = lockAreasRaw ? lockAreasRaw.split(',').filter(Boolean) : []
    const changeAreas = changeAreasRaw ? changeAreasRaw.split(',').filter(Boolean) : []

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No images provided' })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' })
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
              text: buildUserMessage(files.length, userDescription, promptMode, lockAreas, changeAreas),
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
}

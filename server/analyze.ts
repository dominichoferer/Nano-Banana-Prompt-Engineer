import Anthropic from '@anthropic-ai/sdk'
import type { Request, Response } from 'express'

const SYSTEM_PROMPT = `You are an AI image prompt engineer. You create focused, structured prompts for AI image retouching and generation tools.

CRITICAL RULE: Write ONLY the sections that are explicitly requested. Do NOT add Lighting, Color Grading, Background, or Output Specs unless they are in the requested changes list or the user's description explicitly asks for them.

═══════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════

1. HEADER (always)
   Retouch: "USE THE UPLOADED PHOTO(S) AS STRICT REFERENCE BASE.\nTHIS IS A PHOTO RETOUCH — NOT A NEW IMAGE GENERATION."
   Generation: "USE THE UPLOADED PHOTO(S) AS VISUAL STYLE REFERENCE.\nTHIS IS A NEW IMAGE GENERATION INSPIRED BY THE REFERENCE(S)."

2. IMAGE INDEX (always when images present)
   IMAGE INDEX
   ═══════════════════════════════════════════
   — IMAGE 1 — [filename]: [one-line description]
   — IMAGE 2 — [filename]: [one-line description]

3. LOCK SECTIONS (only when locks were set — keep them SHORT and assertive)

   Object/Proportion Lock:
   📐 SUBJECT LOCK — IMAGE [N] ⚠️
   ═══════════════════════════════════════════
   IMAGE [N] is the MASTER REFERENCE. The output must match IMAGE [N] in EVERY visual aspect except the one requested change.
   Preserve EXACTLY: rendering style, lighting, shadows, camera angle, background, surface textures, composition, colors of all unchanged elements.
   THE ONLY PERMITTED CHANGE is what is listed in CHANGES REQUESTED.
   Any other deviation = wrong result.

   Face Lock:
   ⚠️ FACE LOCK — IMAGE [N] ⚠️
   ═══════════════════════════════════════════
   Preserve ALL facial features of the person in IMAGE [N] with pixel-perfect accuracy.
   Do NOT change face shape, eyes, nose, lips, skin tone, hair, or any facial detail.
   If the face is not 100% identical to IMAGE [N], the result is wrong.

   Custom Lock:
   🔒 CUSTOM LOCK — IMAGE [N]
   ═══════════════════════════════════════════
   Preserve EXACTLY: "[custom text]" — must appear identical to IMAGE [N]. No exceptions.

4. REQUESTED CHANGES (always for retouch — describe what must change, clearly and specifically)
   ✏️ CHANGES REQUESTED
   ═══════════════════════════════════════════
   List each requested change. Reference IMAGE numbers. Be specific about what must change and how.

5. OPTIONAL SECTIONS — include ONLY when explicitly in the requested changes or user description:

   Lighting (only if lighting was requested):
   📸 LIGHTING
   ═══════════════════════════════════════════
   Describe the exact lighting setup required.

   Color Grading (only if color change was requested):
   🎨 COLOR GRADING
   ═══════════════════════════════════════════
   Describe the required color treatment and what to avoid.

   Background (only if background change was requested):
   🖼️ BACKGROUND
   ═══════════════════════════════════════════
   Describe the exact background change. Reference source image if applicable.

6. FINAL RULE (always — one concise enforcement line)

═══════════════════════════════════════════
WRITING STYLE
═══════════════════════════════════════════
— Direct imperative: "Preserve exactly:" not "The AI should preserve:"
— Em dashes (—) for list items
— CAPS for headers and critical constraints
— Specific where it matters — no vague terms
— All prompts in English
— No output resolution or quality specs (handled separately by the user)
— No preamble or commentary — output the prompt directly
— ALWAYS reference images by number (IMAGE 1, IMAGE 2, etc.)`

interface ImageSetting {
  name: string
  faceLock: boolean
  objectLock: boolean
  customLock: string
}

const CHANGE_MAP: Record<string, string> = {
  pose:       'Pose & positioning — describe required body alignment, angles, spacing, expression',
  lighting:   'Lighting — describe required lighting setup (include 📸 LIGHTING section)',
  color:      'Color grading — describe required color treatment (include 🎨 COLOR GRADING section)',
  background: 'Background — describe required background change (include 🖼️ BACKGROUND section)',
}

function buildImageIndex(settings: ImageSetting[]): string {
  return settings
    .map((s, i) => `— IMAGE ${i + 1} — "${s.name}"`)
    .join('\n')
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
        `— ⚠️ SUBJECT LOCK (IMAGE ${num}): IMAGE ${num} is the MASTER REFERENCE.\n` +
        `The output must be visually identical to IMAGE ${num} in EVERY aspect except the single explicitly requested change.\n` +
        `Preserve EXACTLY — zero deviation allowed:\n` +
        `  · Rendering style and overall visual treatment (photo-realistic, CGI, product shot — identical to IMAGE ${num})\n` +
        `  · Every light source, shadow, highlight, reflection, and ambient occlusion from IMAGE ${num}\n` +
        `  · Camera angle, focal length, perspective, depth of field — pixel-identical to IMAGE ${num}\n` +
        `  · Background: every detail, color, gradient, surface — identical to IMAGE ${num}\n` +
        `  · Surface finish, material texture, and sheen of all objects in IMAGE ${num}\n` +
        `  · Composition: subject position, size in frame, spatial relationships — identical to IMAGE ${num}\n` +
        `  · Colors of ALL elements that are NOT part of the explicitly requested change\n` +
        `  · Image sharpness, contrast, tonal range — identical to IMAGE ${num}\n` +
        `THE ONLY PERMITTED CHANGE is the one explicitly listed in the CHANGES REQUESTED section below.\n` +
        `Any deviation beyond that single change means the result is wrong.`,
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

  // ── IMAGE REFERENCE HEADER ── always present ──────────────────────────────
  const imageRefSection = count > 0
    ? `═══════════════════════════════════════════
UPLOADED IMAGES — REFERENCE INDEX
═══════════════════════════════════════════
${imageIndexBlock}

The images are attached above in this EXACT ORDER (IMAGE 1 = first attached image, IMAGE 2 = second, etc.).
When you reference a subject, face, background, or any element in the prompt — ALWAYS specify which IMAGE number it comes from.`
    : ''

  // ── GENERATION MODE ────────────────────────────────────────────────────────
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

  // ── RETOUCH MODE ───────────────────────────────────────────────────────────
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

  const areas = changeAreas ?? []
  const sectionsToInclude: string[] = []
  if (hasAnyLocks) sectionsToInclude.push('Lock sections (only for images that have locks set)')
  if (hasChange || userDescription?.trim()) sectionsToInclude.push('CHANGES REQUESTED section (what must change and how)')
  if (areas.includes('lighting')) sectionsToInclude.push('📸 LIGHTING section')
  if (areas.includes('color')) sectionsToInclude.push('🎨 COLOR GRADING section')
  if (areas.includes('background')) sectionsToInclude.push('🖼️ BACKGROUND section')

  const sectionsNote = sectionsToInclude.length > 0
    ? `\nInclude ONLY these sections (besides header + image index):\n${sectionsToInclude.map((s) => `— ${s}`).join('\n')}\nDo NOT add any other sections.`
    : '\nDo NOT add Lighting, Color Grading, Background, or Output Specs — they were not requested.'

  return `USE THE UPLOADED PHOTO(S) AS STRICT REFERENCE BASE.
THIS IS A PHOTO RETOUCH — NOT A NEW IMAGE GENERATION.

${imageRefSection}${locksSection}${changeSection}${userBlock}${instruction}

═══════════════════════════════════════════
TASK
═══════════════════════════════════════════
Analyze all ${count} uploaded image(s) carefully, respecting all lock rules above.${sectionsNote}
Reference images by IMAGE NUMBER (IMAGE 1, IMAGE 2, etc.) throughout.

⛔ CRITICAL OUTPUT RULES — include these verbatim at the end of the prompt:
— OUTPUT: ONE single image only. Do NOT generate multiple versions, side-by-side comparisons, before/after layouts, or grids. One image. Period.
— Do NOT show the original alongside the result. The output IS the modified version.
— If the AI tool would normally output a comparison, STOP — output only the final result.

Start directly with the header line — no preamble.`
}

export async function analyzeImages(req: Request, res: Response) {
  try {
    const files = req.files as Express.Multer.File[]
    const userDescription = req.body?.userDescription as string | undefined
    const promptMode = req.body?.promptMode as string | undefined
    const changeAreasRaw = req.body?.changeAreas as string | undefined
    const changeAreas = changeAreasRaw ? changeAreasRaw.split(',').filter(Boolean) : []

    // Parse per-image settings (new format)
    let imageSettings: ImageSetting[] = []
    try {
      const raw = req.body?.imageSettings as string | undefined
      if (raw) {
        imageSettings = JSON.parse(raw)
      }
    } catch {
      // fallback: create default settings from filenames
    }

    // Ensure imageSettings has an entry per file
    if (imageSettings.length !== files?.length) {
      imageSettings = (files ?? []).map((f) => ({
        name: f.originalname || f.fieldname,
        faceLock: false,
        objectLock: false,
        customLock: '',
      }))
    }

    if ((!files || files.length === 0) && promptMode !== 'generation') {
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
}

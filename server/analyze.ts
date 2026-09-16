import Anthropic from '@anthropic-ai/sdk'
import type { Request, Response } from 'express'

// Der Prompt-Schreiber gibt EIN JSON-Objekt aus, keinen Fliesstext.
//
// Warum JSON: Bildmodelle folgen strukturierten Angaben deutlich zuverlässiger
// als Absätzen. Vor allem aber lässt sich in einem Objekt sauber sagen, WELCHES
// Bild welche Rolle hat und was daraus übernommen werden darf — im Fliesstext
// verschwimmt genau das, und am Ende steht die Person aus dem falschen Bild im
// Ergebnis.
const SYSTEM_PROMPT = `You are a prompt engineer for AI image models. You turn a brief plus
reference photographs into ONE precise, richly specified prompt.

OUTPUT: a single JSON object. No prose before or after, no markdown fence, no commentary.
Modern image models follow structured input far more reliably than paragraphs, and the JSON is
shown to the user for editing — so keep keys stable and values human-readable.

═══════════════════════════════════════════
SCHEMA
═══════════════════════════════════════════
{
  "task": "photo_retouch" | "mockup" | "new_image",
  "directive": "One sentence stating what the model must produce and how it must treat the
                references. Retouch: the uploads are the base and must survive. Mockup: the
                artwork must be applied to the object. New image: the uploads are style only.",
  "reference_images": [
    { "id": "IMAGE 1", "file": "<filename>", "shows": "<what is actually visible — subject,
      framing, background, light, notable detail>", "role": "ausgang" | "ziel" | "person",
      "how_to_use": "<what may be taken from this image, and what may not>" }
  ],
  "preserve": [
    { "image": "IMAGE 1", "what": "<exact element>", "why_it_matters": "<consequence if lost>",
      "tolerance": "pixel_exact" | "recognisable" }
  ],
  "changes": [
    { "target": "<what changes>", "from": "<state in the reference>", "to": "<required state>",
      "detail": "<how precisely — direction, amount, quality>" }
  ],
  "subject": { "who_or_what": "...", "pose": "...", "expression": "...", "wardrobe": "...",
               "notes": "..." },
  "scene": { "location": "...", "background": "...", "props": "...", "time_of_day": "..." },
  "camera": { "shot": "<framing>", "angle": "...", "lens": "<e.g. 85mm portrait>",
              "depth_of_field": "...", "aspect_hint": "..." },
  "lighting": { "setup": "...", "direction": "...", "quality": "<hard/soft, contrast>",
                "practicals": "..." },
  "color": { "palette": "...", "grade": "...", "avoid": "..." },
  "materials_and_texture": "<fabric, surface, print finish, grain — whatever the brief touches>",
  "negative": ["<what must not appear — be concrete>"],
  "output": { "single_image": true, "no_text_overlay": true, "notes": "..." }
}

═══════════════════════════════════════════
RULES
═══════════════════════════════════════════
1. OMIT keys you have nothing substantial to say about. An empty or generic value is worse than
   no key. Never write "n/a", "standard" or "as appropriate".
2. BE LONG WHERE IT COUNTS. "changes" and "preserve" carry the result — write them out fully,
   with direction, amount and consequence. A one-word value there is a failure.
3. Describe EVERY attached image in "reference_images", in order, from what you actually SEE —
   never from the filename. One entry per attached image, no exceptions and no extras. Always
   address images as "IMAGE 1", "IMAGE 2" everywhere else in the JSON.
4. ROLES are assigned by the user and are not yours to change:
   — "ausgang" (SOURCE MATERIAL) is what the result is built FROM. Reproduce it faithfully:
     shape, proportions, material, colour, every print, seam and logo. If a person is shown,
     THAT is the person in the result.
   — "ziel" (TARGET REFERENCE) shows how the result should LOOK — colour grade, light,
     perspective, camera distance, framing, background, mood. Its CONTENT belongs to no one. A
     person visible there is a stand-in, never the subject. Say so in "directive" and add a
     "negative" entry naming the failure ("the face of the person in IMAGE n").
   — "person" is a portrait whose face must appear in the result.
5. IDENTITY IS DECIDED BY ROLE, NEVER BY IMAGE QUALITY. When two images show two different
   people, the face comes from the one marked SOURCE MATERIAL or THE PERSON — even when the
   other is sharper, larger, better lit or more flattering. This is the single most common
   failure of this pipeline. Whenever any attached image shows a human face you MUST write a
   "preserve" entry with tolerance "pixel_exact" naming that image and listing the facial
   features that must survive, plus a "negative" entry forbidding the other person's face.
6. IDENTITY IS NOT FILE QUALITY. Low resolution, JPEG blocking, colour noise and blur belong to
   the FILE, not to the person. Instruct that detail be reconstructed cleanly along that face
   and never borrowed from another image, and that these defects must not appear as blotches or
   discoloured skin. Both a waxy face and a blotchy one are failed results.
7. LOCKS are non-negotiable and belong in "preserve" with tolerance "pixel_exact":
   — Face lock: facial geometry, proportions, skin tone, hairline, beard — the person must be
     recognisable as the same individual.
   — Object lock: the uploaded object is the master; everything except the requested change
     stays identical, including rendering style, camera, background and surface texture.
   — Custom lock: reproduce the named element exactly as it appears in the image.
8. task "photo_retouch": the uploads are the BASE, not inspiration. Say so in "directive" and
   restrict yourself to the requested changes. Everything else must survive untouched.
   EXCEPTION — a target reference is attached: then framing, crop, background, wardrobe and
   lighting are REBUILT to match it, while the subject's identity stays with the source
   material. Do not refuse this as "not a retouch"; write the new crop, background and light out
   in full under "changes", and the face under "preserve".
9. task "mockup": the artwork from the upload goes ONTO the object, following its perspective,
   curvature, folds and lighting. Never redraw, re-letter or restyle the artwork.
10. task "new_image": the uploads are style references only — composition, mood and light, not
    the specific people or objects, unless an image is marked "ausgang" or "person".
11. THE USER'S INSTRUCTION GOVERNS THE SCENE. The references supply identity, object fidelity
    and look. What happens in the picture — action, pose, props, setting — comes from the user's
    description, even when no reference shows it. If the user asks for something none of the
    references contain, invent it and describe it fully.
12. Only describe lighting, colour or background when the brief asks for it, when the task is
    "new_image", or when a change makes it unavoidable. Do not invent a creative direction the
    user did not ask for.
13. "negative" is for concrete failure modes of THIS brief — "second head", "warped lettering",
    "extra fingers", "duplicated logo" — not a generic quality list.
14. In "output" set single_image true and note that no comparison, grid or before/after layout
    may be produced.
15. Everything in English, values as plain readable sentences. Valid JSON: double quotes, no
    trailing commas, no comments.`

/**
 * Wie gründlich der Prompt-Schreiber arbeitet. Die Stufe kostet Wartezeit:
 * `high` (die Voreinstellung des Modells) ist für das Schreiben eines Prompts
 * mehr Sorgfalt, als die Aufgabe braucht.
 */
const ERLAUBTER_AUFWAND = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Aufwand = typeof ERLAUBTER_AUFWAND[number]
const AUFWAND: Aufwand =
  ERLAUBTER_AUFWAND.includes(process.env.ANALYZE_EFFORT as Aufwand)
    ? (process.env.ANALYZE_EFFORT as Aufwand)
    : 'medium'
const ANALYZE_MODEL = process.env.ANALYZE_MODEL?.trim() || ''

interface ImageSetting {
  name: string
  /**
   * Wofür das Bild da ist. „ausgang" = woraus etwas entsteht, „ziel" = wie das
   * Ergebnis aussehen soll, „person" = wessen Gesicht gilt. Ohne diese Angabe
   * sieht der Prompt-Schreiber nur eine flache Bilderliste und beschreibt eine
   * Zielreferenz wie eine Vorlage — dann landen Objekte und Gesichter aus dem
   * falschen Bild im Ergebnis.
   */
  rolle?: 'ausgang' | 'ziel' | 'person'
  /** Der Rollentext im Wortlaut, wie ihn auch das Bildmodell bekommt. */
  rollenRegel?: string
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

const ROLLEN_NAME: Record<string, string> = {
  ausgang: 'SOURCE MATERIAL',
  ziel:    'TARGET REFERENCE (look only)',
  person:  'THE PERSON (identity)',
}

function buildImageIndex(settings: ImageSetting[]): string {
  return settings
    .map((s, i) => {
      const rolle = s.rolle ? ` [${ROLLEN_NAME[s.rolle] ?? s.rolle}]` : ''
      return `— IMAGE ${i + 1} — "${s.name}"${rolle}`
    })
    .join('\n')
}

/**
 * Die Rollen, nach Rolle GRUPPIERT statt je Bild aufgezählt.
 *
 * Gruppiert steht die Regel einmal da und nennt alle Nummern, für die sie gilt
 * („SOURCE MATERIAL: IMAGE 1, IMAGE 3"). Einzeln aufgezählt wiederholt sich
 * derselbe Absatz je Bild, und das Modell liest ihn als drei verschiedene
 * Anweisungen statt als eine, die für drei Bilder gilt.
 */
function buildRollenBlock(settings: ImageSetting[]): string {
  if (settings.every((x) => !x.rolle)) return ''
  const nummern = (rolle: string) => settings
    .map((s, i) => ({ s, n: i + 1 }))
    .filter((x) => x.s.rolle === rolle)

  const zeilen: string[] = ['IMAGE ROLES — the user assigned these explicitly. Respect them exactly:']

  const ausgang = nummern('ausgang')
  const ziel = nummern('ziel')
  const person = nummern('person')

  if (ausgang.length > 0) {
    zeilen.push(`— SOURCE MATERIAL: IMAGE ${ausgang.map((x) => x.n).join(', IMAGE ')}. `
      + 'This is what the result is built FROM, and the only place its content may come from. '
      + 'Reproduce it faithfully — shape, proportions, material, colour, every print and logo. '
      + 'If a person is shown, that person IS the subject of the result: reproduce the face '
      + 'exactly and list it under "preserve" with tolerance pixel_exact.')
  }
  if (ziel.length > 0) {
    zeilen.push(`— TARGET REFERENCE: IMAGE ${ziel.map((x) => x.n).join(', IMAGE ')}. `
      + 'This shows how the result should LOOK, not what it should contain. Take colour grade, '
      + 'light, perspective, camera distance, framing, background and mood from it. Do NOT carry '
      + 'over the objects, garments or people shown in it. Anyone visible here is a stand-in — '
      + 'add a "negative" entry forbidding their face.')
  }
  if (person.length > 0) {
    zeilen.push(`— THE PERSON: IMAGE ${person.map((x) => x.n).join(', IMAGE ')}. `
      + 'This face must appear in the result. Reproduce facial proportions, skin tone, hairline, '
      + 'haircut, beard and build exactly.')
  }
  if (ausgang.length > 0 && ziel.length > 0) {
    zeilen.push('— In short: the WHAT comes from the source material, the HOW from the target '
      + 'reference. Where they disagree — colour, shape, branding, and above all WHO IS DEPICTED '
      + '— the source material wins, every time.')
  }
  zeilen.push('— Identity is decided by ROLE, never by image quality. A small, soft source '
    + 'portrait still outranks a crisp target reference. Low resolution belongs to the FILE, not '
    + 'to the person: reconstruct detail cleanly along that face, never borrow it from another '
    + 'image, and never let compression artefacts show up as blotchy skin.')
  zeilen.push('— THE USER\'S INSTRUCTION GOVERNS THE SCENE. The references supply identity, '
    + 'object fidelity and look. What happens in the picture comes from the user\'s description, '
    + 'even when no reference shows it.')
  zeilen.push('— Your JSON must contain a top-level "reference_images" array with one entry per '
    + 'attached image, in order: { "id": "IMAGE n", "file": "...", "shows": "...", "role": "...", '
    + '"how_to_use": "..." }. Describe every attached image in real detail — what is on it and '
    + 'what is to be taken from it.')

  return `\n\n═══════════════════════════════════════════
IMAGE ROLES — HOW EACH IMAGE MAY BE USED
═══════════════════════════════════════════
${zeilen.join('\n')}`
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

// Exportiert, damit sich der Auftragstext ohne API-Aufruf prüfen lässt.
export function buildUserMessage(
  imageSettings: ImageSetting[],
  userDescription?: string,
  promptMode?: string,
  changeAreas?: string[],
  mockupType?: string,
  mockupEnvironment?: string,
): string {
  const count = imageSettings.length
  const isGeneration = promptMode === 'generation'
  const isMockup = promptMode === 'mockup'
  const hasChange = (changeAreas?.length ?? 0) > 0
  const imageIndexBlock = buildImageIndex(imageSettings)
  const rollenBlock = buildRollenBlock(imageSettings)
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

  // ── MOCKUP MODE ────────────────────────────────────────────────────────────
  if (isMockup) {
    const typeLabels: Record<string, string> = {
      folder: 'premium document folder / presentation folder',
      flyer: 'DIN A5 printed flyer',
      billboard: 'large-format outdoor billboard / citylight poster',
      webseite: 'laptop or desktop browser screen mockup',
      tshirt: 'folded or worn T-shirt',
      tasse: 'ceramic coffee mug',
      buch: 'hardcover book or magazine',
      visitenkarte: 'business card on a surface',
      flasche: 'premium bottle or tube packaging',
      verpackung: 'product packaging box',
    }
    const typeLabel = mockupType ? typeLabels[mockupType] ?? mockupType : null
    const mockupTarget = typeLabel
      ? `Create a high-end studio mockup: place the uploaded artwork/design exactly onto a ${typeLabel}.`
      : userDescription?.trim()
        ? `Create a high-end studio product mockup for: "${userDescription.trim()}"`
        : `Create a high-end studio product mockup for the uploaded design.`

    const envNote = mockupEnvironment === 'dark'
      ? `ENVIRONMENT — DARK STUDIO:
— Background: deep charcoal or near-black (#0d0d0d–#1a1a1a), seamless infinity curve.
— Key light: single hard-edge spot or snooted strobe from upper-right, casting a crisp dramatic shadow to the left.
— Fill: minimal, dark side stays dark — ratio approximately 5:1 key-to-fill or harder.
— Rim/separation light: subtle cool-toned backlight outlining the object edge.
— Surface: dark matte or polished stone/acrylic — faint specular reflection of the object visible.
— Mood: editorial dark luxury — think high-fashion or premium spirits photography.`
      : mockupEnvironment === 'light'
        ? `ENVIRONMENT — BRIGHT STUDIO:
— Background: pure white or warm off-white (#f8f8f6), seamless infinity curve, no visible horizon line.
— Key light: large softbox or window light from upper-left, soft shadow falloff.
— Fill: broad ambient fill from opposite side, ratio approximately 2:1 — near-shadowless, airy.
— Surface: white or light grey matte — very soft diffused contact shadow beneath the object only.
— Mood: clean product-catalog / e-commerce — think Apple, Muji, luxury skincare.`
        : `ENVIRONMENT — NEUTRAL STUDIO:
— Background: neutral mid-grey or warm cream, seamless.
— Balanced 3-point lighting: key, fill, rim — professional product photography standard.
— Choose lighting mood that best complements the design's color palette.`

    const extraDesc = userDescription?.trim() ? `\nADDITIONAL INSTRUCTIONS: "${userDescription.trim()}"` : ''

    return `HIGH-END STUDIO MOCKUP — professional product photography aesthetic.

${imageRefSection}

${mockupTarget}

${envNote}${extraDesc}

DESIGN PLACEMENT & PRESERVATION:
— Reproduce the uploaded design with 100% fidelity: exact colors, typography, logo, proportions, layout.
— Apply photorealistic perspective distortion and surface curvature matching the mockup geometry.
— Wrap lighting and shadows over the design surface naturally — highlight on raised edges, shadow in recesses.
— Do NOT alter, reinterpret, simplify, or stylize the design content in any way.
— The design must be readable and sharp — not blurry, not oversaturated.

QUALITY STANDARD:
— CGI / studio photography hybrid quality — indistinguishable from a professional product shoot.
— Depth of field: sharp on the object, very slight background blur (f/5.6–f/8 equivalent).
— No lens flare, no Instagram filters, no vignette, no watermarks.

OUTPUT: ONE single mockup image. No comparisons, no before/after layouts, no grids.
Start directly with the prompt — no preamble.`
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

  // Der Auftragstext ist die Absicht — die Bilder sind nur das Material. Und
  // wenn dort „Bild 2" steht, muss zweifelsfrei feststehen, welches gemeint
  // ist: dieselbe Nummer, die auch das Bildmodell später sieht.
  const userBlock = userDescription?.trim()
    ? `\n\n═══════════════════════════════════════════
USER'S INTENT — this governs the scene
═══════════════════════════════════════════
"${userDescription.trim()}"

RESOLVING THE USER'S IMAGE REFERENCES — do this explicitly before you write anything:
— "Bild 1" / "Image 1" / "das erste Bild" / "the first image" = IMAGE 1 in the index above.
— "Bild 2" / "Image 2" / "das zweite Bild" = IMAGE 2, and so on. The numbering is the one in
  the index; it is already the numbering the image model will see.
— "die Vorlage" / "das Ausgangsbild" / "das Original" / "the source" = the image(s) with role
  SOURCE MATERIAL.
— "das Ziel" / "die Zielreferenz" / "so soll es aussehen" / "the look" = the image(s) with role
  TARGET REFERENCE.
— "die Person" / "das Gesicht" without a number = the face in the SOURCE MATERIAL, never the
  one in a TARGET REFERENCE.
If a reference is genuinely ambiguous, resolve it in "directive" in one sentence, naming the
image number you chose and why. Never silently pick one.
Carry these resolutions through: everywhere you mention an image in the JSON, use its IMAGE
number, never a filename and never "the other one".`
    : ''

  const instruction = !hasAnyLocks && !hasChange && !userDescription?.trim()
    ? `\n\nPerfectly retouch and enhance all images while preserving every detail of the originals.`
    : ''

  const areas = changeAreas ?? []
  // Welche Schlüssel des JSON gefüllt werden sollen. Alles andere bleibt weg —
  // ein leerer Schlüssel ist schlechter als gar keiner.
  const sectionsToInclude: string[] = ['"reference_images" — one entry per attached image, in order']
  // „preserve" ist die einzige Stelle, an der etwas pixelgenau festgenagelt
  // wird. Sobald Ausgangsmaterial vorhanden ist, MUSS sie kommen: Wer den
  // Wunsch nur in den Auftragstext schreibt, bekam sie sonst nie, und er
  // verwässerte zu einer Änderung unter vielen.
  const hatAusgang = imageSettings.some((x) => x.rolle === 'ausgang' || x.rolle === 'person')
  if (hasAnyLocks) {
    sectionsToInclude.push('"preserve" — one entry per lock, tolerance pixel_exact')
  } else if (hatAusgang) {
    sectionsToInclude.push('"preserve" — everything the source material must carry into the '
      + 'result, and the face with tolerance pixel_exact if a person is shown')
  }
  if (hasChange || userDescription?.trim()) sectionsToInclude.push('"changes" — what must change and how, written out fully')
  if (areas.includes('lighting')) sectionsToInclude.push('"lighting"')
  if (areas.includes('color')) sectionsToInclude.push('"color"')
  if (areas.includes('background')) sectionsToInclude.push('"scene.background"')

  const sectionsNote = `\nFill these keys:\n${sectionsToInclude.map((s) => `— ${s}`).join('\n')}`
    + (areas.length === 0
      ? '\nDo NOT fill "lighting", "color" or "scene.background" — they were not requested.'
      : '')

  return `USE THE UPLOADED PHOTO(S) AS STRICT REFERENCE BASE.
THIS IS A PHOTO RETOUCH — NOT A NEW IMAGE GENERATION.

${imageRefSection}${rollenBlock}${locksSection}${changeSection}${userBlock}${instruction}

═══════════════════════════════════════════
TASK
═══════════════════════════════════════════
Analyze all ${count} uploaded image(s) carefully, respecting all lock rules above.${sectionsNote}

Write "reference_images" first — one entry per attached image, in order, describing what you
actually see on each. Then let everything else refer back to those IMAGE numbers.

In "output" set single_image true and note that no comparison, grid or before/after layout may
be produced. Put the concrete failure modes of THIS brief into "negative".

Output the JSON object and nothing else — no preamble, no markdown fence.`
}

export async function analyzeImages(req: Request, res: Response) {
  try {
    const files = req.files as Express.Multer.File[]
    const userDescription = req.body?.userDescription as string | undefined
    const promptMode = req.body?.promptMode as string | undefined
    const changeAreasRaw = req.body?.changeAreas as string | undefined
    const changeAreas = changeAreasRaw ? changeAreasRaw.split(',').filter(Boolean) : []
    const mockupType = req.body?.mockupType as string | undefined
    const mockupEnvironment = req.body?.mockupEnvironment as string | undefined

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

    // Jedes Bild bekommt seine Nummer und Rolle UNMITTELBAR davor. Lagen erst
    // alle Bilder und danach der Text, musste das Modell aus der Reihenfolge
    // erschliessen, welches Bild welches ist — bei vier Vorlagen ging das
    // regelmässig daneben, und die Beschreibung von IMAGE 2 landete bei IMAGE 3.
    const ROLLEN_NAME_KURZ: Record<string, string> = {
      ausgang: 'SOURCE MATERIAL — content and identity come from here',
      ziel: 'TARGET REFERENCE — look only, never its content or its people',
      person: 'THE PERSON — this face must appear in the result',
    }
    const imageContent: Anthropic.ContentBlockParam[] = files.flatMap((file, i): Anthropic.ContentBlockParam[] => {
      const s = imageSettings[i]
      const rolle = s?.rolle ? ` [${ROLLEN_NAME_KURZ[s.rolle] ?? s.rolle}]` : ''
      const marke: Anthropic.TextBlockParam = {
        type: 'text',
        text: `IMAGE ${i + 1} — "${s?.name ?? file.originalname}"${rolle}`,
      }
      if (file.mimetype === 'application/pdf') {
        return [marke, {
          type: 'document' as const,
          source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: file.buffer.toString('base64') },
        }]
      }
      return [marke, {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          data: file.buffer.toString('base64'),
        },
      }]
    })

    const messageParams = {
      // Ein vollständiges JSON mit ausformulierten "changes" und "preserve"
      // braucht Platz. Bei 3000 brach die Ausgabe mitten im Objekt ab, und der
      // Nutzer bekam kaputtes JSON.
      max_tokens: 16000,
      // Der System-Prompt ist unveränderlich und wird zwischengespeichert.
      system: [{ type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }],
      // Nachdenken bleibt an — Bildanalyse und Rollenzuordnung sind genau die
      // Aufgabe, bei der es sich auszahlt.
      // `summarized`: Ohne das bleibt der Denkteil leer, und auf dem Bildschirm
      // passiert minutenlang nichts — es sieht aus, als hinge das Werkzeug.
      // So läuft mit, woran gerade gearbeitet wird. Kosten ändert das nicht,
      // gedacht wird ohnehin.
      thinking: { type: 'adaptive' as const, display: 'summarized' as const },
      // ABER: nicht auf der höchsten Stufe. Ohne Angabe rechnet Opus 5 mit
      // `high`, und das dauert bei drei, vier Bildern spürbar lange — für das
      // Schreiben eines Prompts ist das verschwendet. `medium` liefert
      // dasselbe Ergebnis deutlich schneller.
      //
      // Über ANALYZE_EFFORT umstellbar: low (am schnellsten), medium,
      // high, xhigh, max. Wer bei einem schwierigen Auftrag mehr Sorgfalt
      // will, setzt es hoch, ohne dass am Code etwas geändert werden muss.
      output_config: { effort: AUFWAND },
      messages: [
        {
          role: 'user' as const,
          content: [
            ...imageContent,
            {
              type: 'text' as const,
              text: buildUserMessage(imageSettings, userDescription, promptMode, changeAreas, mockupType, mockupEnvironment),
            },
          ],
        },
      ],
    }

    // Voreinstellung Opus 5; Sonnet 5 ist der Rückfall, wenn Opus überlastet
    // ist — und über ANALYZE_MODEL auch als Erstwahl setzbar, wenn Tempo vor
    // allem anderen geht.
    const MODELS = ANALYZE_MODEL
      ? [ANALYZE_MODEL, 'claude-sonnet-5'].filter((m, i, a) => a.indexOf(m) === i)
      : ['claude-opus-5', 'claude-sonnet-5']
    let lastErr: unknown

    for (const model of MODELS) {
      try {
        const stream = client.messages.stream({ ...messageParams, model })

        // Only send headers once we have a live stream
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Connection', 'keep-alive')
          res.flushHeaders()
        }

        for await (const event of stream) {
          if (event.type !== 'content_block_delta') continue
          if (event.delta.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`)
          } else if (event.delta.type === 'thinking_delta') {
            // Getrennter Typ, damit der Denkteil NICHT im Prompt landet.
            res.write(`data: ${JSON.stringify({ type: 'denken', text: event.delta.thinking })}\n\n`)
          }
        }

        const finalMessage = await stream.finalMessage()
        res.write(`data: ${JSON.stringify({ type: 'done', usage: finalMessage.usage })}\n\n`)
        res.end()
        return
      } catch (err) {
        const anyErr = err as { status?: number; message?: string }
        const isOverloaded =
          anyErr?.status === 529 ||
          (typeof anyErr?.message === 'string' && anyErr.message.includes('overloaded'))
        const hasNextModel = model !== MODELS[MODELS.length - 1]
        if (isOverloaded && hasNextModel) {
          const next = MODELS[MODELS.indexOf(model) + 1]
          console.warn(`[analyze] ${model} overloaded (529), retrying with ${next}…`)
          lastErr = err
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
        throw err
      }
    }

    throw lastErr
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

// Eine geordnete Liste aller Bilder, die an das Bildmodell gehen — und dieselbe
// Liste geht an den Prompt-Schreiber.
//
// Der Grund für dieses Modul: Sobald bei der Generierung Bilder dazukommen, die
// der Prompt-Schreiber nicht gesehen hat, stimmt die Nummerierung nicht mehr
// überein — was das JSON „IMAGE 2" nennt, ist beim Bildmodell ein anderes Bild.
// Deshalb wird die Reihenfolge einmal festgelegt und von beiden Seiten benutzt.

export type RefRolle =
  | 'ausgang'   // woraus etwas entstehen soll — wird originalgetreu übernommen
  | 'ziel'      // wie das Ergebnis aussehen soll — Farbe, Licht, Perspektive
  | 'person'    // Porträt, dessen Gesicht im Ergebnis stehen muss

export interface RefBild {
  mimeType: string
  data: string
  rolle: RefRolle
  /** Was auf dem Bild zu sehen ist — wandert wörtlich in den JSON-Prompt. */
  zeigt: string
}

/** Wie das Bildmodell mit der jeweiligen Rolle umgehen soll. */
export const ROLLEN_REGEL: Record<RefRolle, string> = {
  ausgang:
    'SOURCE MATERIAL — what the result is built FROM, and the only place its content may come '
    + 'from. Reproduce it faithfully: shape, proportions, material, colour, every print, seam and '
    + 'logo. It must be recognisable as this exact item, not a similar one. '
    // Ohne diesen Satz wird ein Porträt wie ein Gegenstand gelesen — und das
    // Gesicht kommt am Ende aus der besser aufgelösten Zielreferenz.
    + 'IF A PERSON IS SHOWN, THAT PERSON IS THE SUBJECT OF THE RESULT: reproduce the face exactly '
    + '— facial geometry, jaw and cheekbones, eye shape, spacing and colour, nose, mouth, ear '
    + 'shape, hairline, hair texture, beard, skin tone and apparent age. Never substitute, '
    + 'beautify, average or swap that face, and never take it from another image. '
    // Der Unterschied, der beim ersten Versuch fehlte: WER die Person ist, kommt
    // aus der Vorlage — WIE SAUBER das Bild ist, nicht. Ein 12-KB-JPEG hat
    // Blockartefakte und Farbrauschen; ohne diesen Satz hält das Modell sie für
    // Hautmerkmale und malt sie gross und scharf aus. Das Gesicht wird fleckig.
    + 'IDENTITY IS NOT THE SAME AS FILE QUALITY. Take from this image only WHO the person is: '
    + 'facial geometry, proportions, skin tone, hair and features. Do NOT take compression '
    + 'artefacts, JPEG blocking, colour noise, banding, posterisation, mottling, blur or dirt '
    + 'from it — those belong to the file, not to the person, and must not appear as blotches, '
    + 'patches, discoloured areas or texture on the skin. Render clean, even, healthy skin in '
    + 'that person\'s own tone, with natural fine texture and no invented marks, scars or '
    + 'pigment patches. If the source is small or soft, upscale it cleanly rather than '
    + 'reproducing its defects.',
  ziel:
    'TARGET REFERENCE — how the result should LOOK, not what it should contain. Take colour grade, '
    + 'light direction and quality, perspective, camera distance, framing, background and mood from '
    + 'it. Do NOT copy the objects, garments, people or text shown in it. '
    + 'ANY PERSON VISIBLE HERE IS A STAND-IN, shown only to demonstrate crop, pose, background and '
    + 'lighting. That person is NOT the subject: their face, head shape, hairline, skin tone and '
    + 'build must not appear in the result, not even partially and not blended with anyone else.',
  person:
    'THE PERSON — the real face that must appear. Reproduce facial proportions, skin tone, hairline, '
    + 'haircut, beard and build exactly. Do not beautify, average or substitute the face.',
}

const ROLLEN_FOLGE: RefRolle[] = ['ausgang', 'ziel', 'person']

/** Höchstzahl der Bilder je Auftrag. Darüber wird die Anfrage träge und teuer. */
export const MAX_REFERENZEN = 16

// Wird gekürzt, fällt das Verzichtbare zuerst — das Ausgangsmaterial nie.
const KUERZ_FOLGE: RefRolle[] = ['ziel', 'person', 'ausgang']

// Generisch über die Rolle: Die Aufrufer halten oft mehr am Bild (Datei,
// Vorschau, Maße) und sollen es nicht vorher wegwerfen müssen.
export function begrenze<T extends { rolle: RefRolle }>(liste: T[], max = MAX_REFERENZEN): T[] {
  if (liste.length <= max) return liste
  const behalten = liste.map(() => true)
  let uebrig = liste.length
  for (const rolle of KUERZ_FOLGE) {
    for (let i = liste.length - 1; i >= 0 && uebrig > max; i--) {
      if (behalten[i] && liste[i].rolle === rolle) { behalten[i] = false; uebrig-- }
    }
    if (uebrig <= max) break
  }
  return liste.filter((_, i) => behalten[i])
}

/** Nummernbereich als lesbare Angabe: „IMAGE 3" oder „IMAGES 3–5". */
function bereich(nummern: number[]): string {
  if (nummern.length === 1) return `IMAGE ${nummern[0]}`
  const lueckenlos = nummern.every((n, i) => i === 0 || n === nummern[i - 1] + 1)
  return lueckenlos
    ? `IMAGES ${nummern[0]}–${nummern[nummern.length - 1]}`
    : `IMAGES ${nummern.join(', ')}`
}

/**
 * Die Legende, die vor dem Prompt steht. Sie sagt für jede Nummer, was das Bild
 * ist und wie damit umzugehen ist — ohne sie rät das Modell.
 */
export function baueLegende(liste: RefBild[]): string {
  if (liste.length === 0) return ''
  const zeilen: string[] = []
  for (const rolle of ROLLEN_FOLGE) {
    const treffer = liste
      .map((b, i) => ({ b, nr: i + 1 }))
      .filter((x) => x.b.rolle === rolle)
    if (treffer.length === 0) continue
    zeilen.push(`${bereich(treffer.map((x) => x.nr))} = ${ROLLEN_REGEL[rolle]}`)
    for (const t of treffer) zeilen.push(`   · IMAGE ${t.nr}: ${t.b.zeigt}`)
  }
  const hatBeide = liste.some((b) => b.rolle === 'ausgang') && liste.some((b) => b.rolle === 'ziel')
  if (hatBeide) {
    zeilen.push('The WHAT comes from the source material, the HOW from the target reference. '
      + 'Where they disagree — the object\'s colour, its shape, its branding, and above all WHO IS '
      + 'DEPICTED — the source material wins, every time. Identity is never taken from the target '
      + 'reference, no matter how much sharper or better lit it is.')
  }
  // Ohne diesen Satz behandelt das Modell die Vorlagen als Vorgabe für den
  // Bildinhalt und ignoriert, was im Auftrag steht.
  zeilen.push(
    'THE INSTRUCTION BELOW GOVERNS THE SCENE. These images supply identity, object fidelity and '
    + 'look — they do NOT decide what happens in the picture. The action, the pose, the props and '
    + 'the setting come from the instruction, even when no reference shows them. If the instruction '
    + 'asks for something no reference contains, create it.',
  )
  return `IMAGE ROLES — READ THIS BEFORE ANYTHING ELSE. ${liste.length} images are attached, in this exact order:\n`
    + zeilen.join('\n')
}

/** Dieselbe Information maschinenlesbar, für den Block `reference_images` im JSON. */
export function bildManifest(liste: RefBild[]): Array<{ id: string; shows: string; role: string; how_to_use: string }> {
  return liste.map((b, i) => ({
    id: `IMAGE ${i + 1}`,
    shows: b.zeigt,
    role: b.rolle,
    how_to_use: ROLLEN_REGEL[b.rolle],
  }))
}

/**
 * Trägt das Manifest in einen fertigen JSON-Prompt ein. Der Prompt-Schreiber
 * kennt die endgültige Reihenfolge nicht sicher, deshalb wird der Block hier
 * deterministisch gesetzt statt ihm überlassen.
 */
export function setzeManifest(promptText: string, liste: RefBild[]): string {
  const roh = promptText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
  if (liste.length === 0) return roh
  try {
    const j = JSON.parse(roh)
    if (typeof j !== 'object' || j === null) return roh
    // Der Prompt-Schreiber hat die Bilder gesehen und beschreibt sie oft besser.
    // Seine Beschreibung wird übernommen, Nummer und Rolle kommen aber aus der
    // tatsächlichen Reihenfolge — sonst stehen zwei Listen im JSON, die sich
    // widersprechen.
    const vorhanden = new Map<string, { shows?: string }>()
    for (const feld of ['source_images', 'reference_images', 'images'] as const) {
      const alt = (j as Record<string, unknown>)[feld]
      if (Array.isArray(alt)) {
        for (const e of alt) {
          if (e && typeof e === 'object' && typeof (e as { id?: string }).id === 'string') {
            vorhanden.set((e as { id: string }).id, e as { shows?: string })
          }
        }
      }
      delete (j as Record<string, unknown>)[feld]
    }
    j.reference_images = bildManifest(liste).map((e) => {
      const beschrieben = vorhanden.get(e.id)?.shows
      return beschrieben && beschrieben.length > e.shows.length
        ? { ...e, shows: `${e.shows} — ${beschrieben}` }
        : e
    })
    return JSON.stringify(j, null, 2)
  } catch {
    return roh
  }
}

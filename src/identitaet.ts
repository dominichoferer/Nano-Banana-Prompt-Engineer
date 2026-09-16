// Identität: wessen Gesicht im Ergebnis stehen muss — und wie man das so
// formuliert, dass ein Bildmodell sich daran hält.
//
// Der Anlass: Im Ausgangsmaterial lag ein Porträt (Thumbnail, wenige KB), in
// der Zielreferenz ein anderes Porträt (658 KB, scharf). Im Auftrag stand
// „100 % Gesicht von Ausgangsmaterial". Heraus kam die Person aus der
// Zielreferenz. Zwei Gründe, beide hier behoben:
//
//  1. Ohne gesetzten Gesicht-Lock nimmt analyze.ts den Key "preserve" gar nicht
//     erst in die Liste auf — der Wunsch war bloßer Fließtext und landete
//     bestenfalls unter "changes", also als weiche Änderung.
//  2. Die Rollentexte beschrieben Gegenstände („shape, material, every print,
//     seam and logo"). Für ein Gesicht stand dort nichts. Das Modell nahm das
//     Gesicht, das es besser sehen konnte — das falsche.

/**
 * Wendungen, mit denen man verlangt, dass das Gesicht aus dem Ausgangsmaterial
 * stammt. Absichtlich nah am Wortlaut gehalten: Eine zu weite Erkennung würde
 * den Lock auch dann setzen, wenn nur beiläufig ein Gesicht erwähnt wird — und
 * ein Gesicht-Lock auf einem Produktfoto macht den Prompt schlechter, nicht
 * besser.
 */
const GESICHT_MUSTER: RegExp[] = [
  // Ausdrücklich beim Namen genannt
  /gesicht[s]?[\s-]?lock/i,
  /face[\s-]?lock/i,
  // „Gesicht von/aus dem Ausgangsmaterial", „Gesicht wie Bild 1"
  // „Referenz" ohne Nummer gehoert dazu: Ein Auftrag wie „aus gesicht von
  // referenz ein portrait wie bei ziel" wurde sonst verpasst, weil das Muster
  // „referenz 1" verlangte. Gemeint ist immer das Ausgangsmaterial; die andere
  // Seite heisst im Auftrag „Ziel".
  /gesicht\w*[^.!?]{0,40}\b(ausgangs\w*|ausgangsbild|original|vorlage|referenz|bild\s*1|source)\b/i,
  /\b(ausgangs\w*|original|vorlage|referenz|source)\b[^.!?]{0,40}\bgesicht/i,
  // „Gesicht behalten/bleibt gleich/exakt/unverändert/100 %"
  /gesicht\w*[^.!?]{0,30}\b(bei)?(behalten|bleibt|bleiben|erhalten|gleich\w*|identisch|exakt|unver[äa]ndert|nicht\s+[äa]ndern)\b/i,
  /\b(100\s*%|hundert\s*prozent)[^.!?]{0,30}gesicht/i,
  // Person statt Gesicht
  /\b(die\s+)?(selbe|gleiche|dieselbe)\s+person\b/i,
  /\bperson\b[^.!?]{0,30}\b(muss|soll)\b[^.!?]{0,30}\b(gleich\w*|identisch|erkennbar)\b/i,
  /identit[äa]t\w*[^.!?]{0,30}\b(bei)?(behalten|bleiben|erhalten|wahren|gleich\w*)\b/i,
  // Englisch
  /\bsame\s+(face|person|identity)\b/i,
  /\bkeep\b[^.!?]{0,25}\bface\b/i,
  /\bface\b[^.!?]{0,25}\bfrom\b[^.!?]{0,25}\b(source|image\s*1|original)\b/i,
]

/**
 * Verlangt der Auftragstext ausdrücklich das Gesicht aus dem Ausgangsmaterial?
 * Dann wird der Gesicht-Lock von selbst gesetzt.
 */
export function willGesichtLock(text?: string): boolean {
  const t = text?.trim()
  if (!t) return false
  return GESICHT_MUSTER.some((r) => r.test(t))
}

/** Nummernliste als „IMAGE 1", „IMAGE 1 and IMAGE 2", „IMAGE 1, IMAGE 2 and IMAGE 3". */
function nummern(liste: number[]): string {
  const teile = liste.map((n) => `IMAGE ${n}`)
  if (teile.length <= 1) return teile[0] ?? ''
  return `${teile.slice(0, -1).join(', ')} and ${teile[teile.length - 1]}`
}

/**
 * Die Auflage, die ganz ans Ende des Prompts gehört.
 *
 * Warum ans Ende: Die Rollen-Legende steht vor dem JSON, und was zuletzt gelesen
 * wird, wiegt beim Bildmodell schwerer. Die Identität ist die eine Sache, die
 * jede freiere Formulierung im JSON überstimmen muss.
 *
 * @param ausgang Bildnummern des Ausgangsmaterials (1-basiert)
 * @param ziel    Bildnummern der Zielreferenz (1-basiert)
 */
export function identitaetsKlausel(ausgang: number[], ziel: number[]): string {
  if (ausgang.length === 0) return ''
  const quelle = nummern(ausgang)

  const teile = [
    'IDENTITY — THIS SECTION OVERRIDES EVERYTHING ABOVE, INCLUDING THE JSON.',
    `The person in the result is the person in ${quelle}. Reproduce that face exactly: skull and `
    + 'jaw shape, cheekbones, brow ridge, eye shape, spacing and colour, nose bridge and width, '
    + 'lip shape and thickness, ear shape and position, hairline, hair texture and fall, beard '
    + 'pattern, skin tone and complexion, apparent age. Do not beautify it, do not slim it, do '
    + 'not make it more symmetrical, do not age it up or down.',
  ]

  if (ziel.length > 0) {
    teile.push(
      `${nummern(ziel)} shows a DIFFERENT person. That person is a stand-in: they are there to `
      + 'show framing, crop, pose, background and lighting, nothing else. Their face, head shape, '
      + 'hairline, skin tone and build must NOT appear in the result. Do not blend the two faces, '
      + 'do not average them, and do not produce someone who merely resembles the source. If the '
      + `result could be mistaken for the person in ${nummern(ziel)}, it is wrong and must be `
      + 'discarded.',
    )
  }

  teile.push(
    // Der Fehler des ersten Durchlaufs: „reproduce exactly" plus „reconstruct
    // sharp detail" liess das Modell die Blockartefakte des 12-KB-JPEGs für
    // Hautmerkmale halten und gross ausmalen. Identitaet und Dateiqualitaet
    // muessen getrennt benannt werden, sonst wird das Gesicht fleckig.
    `IDENTITY IS NOT FILE QUALITY. ${quelle} ${ausgang.length > 1 ? 'are' : 'is'} small and heavily `
    + 'compressed. Its JPEG blocking, colour noise, banding, posterisation, mottling, blur and '
    + 'dirt are defects of the FILE. They are NOT features of this person and must NOT be '
    + 'reproduced: no blotches, no patches, no discoloured or uneven areas, no invented marks, '
    + 'scars or pigment spots on the face. Skin must come out clean, even and healthy in that '
    + "person's own tone, with natural fine texture — as if the same person had been photographed "
    + 'properly in a studio.',
    `So: take WHO from ${quelle} — geometry, proportions, features, skin tone, hair. Take HOW `
    + 'CLEAN from a well-exposed studio portrait standard, never from the source file. Reconstruct '
    + `sharp eyes, lashes and hair at full output resolution along the face in ${quelle}, and `
    + 'never fill missing detail from another reference. Both a blurred, waxy face and a blotchy, '
    + 'patchy one are failed results.',
    `Test before finishing: someone who knows the person in ${quelle} must recognise them at a `
    + 'glance, and the skin must look like skin, not like a compressed photograph.',
  )

  return teile.join('\n')
}

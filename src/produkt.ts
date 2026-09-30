// Produktfotos: was am Ende des Prompts stehen muss, damit das Teil exakt
// dasselbe bleibt — und damit ein Schatten nicht als Rauch zurückkommt.
//
// Wie die Identitätsklausel gehört das ans ENDE: Beim Bildmodell wiegt das
// zuletzt Gelesene schwerer, und diese Punkte müssen jede freiere Formulierung
// im JSON davor überstimmen.

import type { SchattenArt } from './schatten'

/** Wer den Schatten macht, wenn freigestellt ausgegeben wird. */
export type SchattenQuelle = 'app' | 'modell'

function nummern(liste: number[]): string {
  const teile = liste.map((n) => `IMAGE ${n}`)
  if (teile.length <= 1) return teile[0] ?? ''
  return `${teile.slice(0, -1).join(', ')} and ${teile[teile.length - 1]}`
}

/**
 * Braucht dieser Auftrag die Gesichtsklausel? Nur wenn überhaupt ein Mensch im
 * Spiel ist. Auf einem Produktfoto stand sonst ganz am Ende, an der
 * wirksamsten Stelle des Prompts, ein Absatz über Kieferform und Haaransatz —
 * und die Aufmerksamkeit für das Teil selbst fehlte.
 */
export function brauchtIdentitaet(prompt: string, hatPersonRolle: boolean, hatGesichtLock: boolean): boolean {
  if (hatPersonRolle || hatGesichtLock) return true
  return /\b(face|facial|person|portrait|woman|man|people|skin|hairline)\b/i.test(prompt)
}

/**
 * Das Teil bleibt das Teil. Der häufigste Fehler bei technischen Produkten:
 * ein Bild, das auf den ersten Blick stimmt, aber eine Bohrung zu wenig, eine
 * Kühlrippe zu viel oder eine gravierte Zeile in Fantasieschrift hat.
 */
export function produktKlausel(ausgang: number[]): string {
  if (ausgang.length === 0) return ''
  const q = nummern(ausgang)
  return [
    'PRODUCT FIDELITY — THIS SECTION OVERRIDES EVERYTHING ABOVE, INCLUDING THE JSON.',
    `The product is the exact object in ${q}, not a similar one and not a redesign. Keep its `
    + 'silhouette, proportions and the viewing angle it is shown from. Every hole, thread, slot, '
    + 'pocket, fin, rib, chamfer, fillet, screw and edge stays in number, size and position — '
    + 'count them, do not add, drop, merge or straighten any. Surface finish stays as supplied: '
    + 'anodised colour and its exact hue, brushed or bead-blasted texture, machining marks, gloss '
    + 'level. Engraved or printed text is reproduced character for character, or left as it is '
    + 'when too small to read — never replaced by invented lettering.',
    'Improve only the photography — light, cleanliness, sharpness — never the object itself. '
    + 'Edges stay crisp and straight where they are straight; nothing melts, bends or blurs.',
  ].join('\n')
}

/**
 * Freigestellte Ausgabe. Zwei Wege, je nachdem, wer den Schatten macht:
 *
 *  • `app` — das Modell liefert NUR das Teil. Schatten und Spiegelung legt die
 *    App danach selbst darunter. Der verlässliche Weg: Ein weicher Schatten
 *    braucht halbe Deckkraft im Alphakanal, und genau die würfeln die Modelle
 *    als Rauschen aus.
 *  • `modell` — das Modell soll den Schatten selbst in den Alphakanal legen.
 *    Dafür muss so genau wie möglich beschrieben sein, WIE dieser Kanal
 *    aussieht, sonst kommt die bekannte graue Wolke.
 */
export function freistellKlausel(quelle: SchattenQuelle, art: SchattenArt | null): string {
  const kopf = 'TRANSPARENT OUTPUT — THIS SECTION OVERRIDES EVERYTHING ABOVE, INCLUDING THE JSON.'
  const grund = 'The background is fully transparent: alpha 0 everywhere that is not the product. '
    + 'No floor, no backdrop, no gradient, no vignette, no painted checkerboard, no grey haze, no '
    + 'fog, dust, smoke or noise anywhere in the transparent area. The product itself is fully '
    + 'opaque, including its dark and metallic areas, with a clean anti-aliased edge one to two '
    + 'pixels wide — no halo, no fringe of the old background colour.'

  if (quelle === 'app' || !art || art === 'keiner') {
    return [kopf, grund,
      'Render NO shadow and NO reflection of any kind — not under the product, not beside it, not '
      + 'faint. A shadow or reflection requested above is added afterwards in compositing and must '
      + 'NOT be in this image. Keep the light on the product itself exactly as described, including '
      + 'its highlights and self-shading.',
    ].join('\n')
  }

  const schatten = 'THE SHADOW is a single smooth, continuous gradient of pure black with partial '
    + 'alpha — no texture, no grain, no dithering, no speckles, no blotches, no cloud or smoke '
    + 'pattern. It lies on the ground plane only: darkest in a thin line exactly where the product '
    + 'touches the ground (alpha about 0.6), softening evenly and reaching alpha 0 within about a '
    + 'tenth of the product\'s height. It follows the outline of the product\'s base and does not '
    + 'extend to the image edges. Outside that narrow band the alpha is exactly 0.'
  const spiegel = 'THE REFLECTION is a mirror image of the product directly below its base, as on a '
    + 'glossy floor — same perspective, same colours, flipped vertically at the line of contact. '
    + 'It starts at alpha about 0.35 where it touches the product and fades smoothly to alpha 0 '
    + 'within a third of the product\'s height. It is a clean, slightly softened copy — no '
    + 'noise, no ripples, no second object.'
  const boden = 'THE SHADOW is one soft oval of pure black beneath the product, as under light from '
    + 'above — a smooth gradient with no texture, no grain and no blotches, darkest at its centre '
    + '(alpha about 0.45) and reaching alpha 0 at its rim, barely wider than the product.'

  const teile = [kopf, grund]
  if (art === 'kontakt') teile.push(schatten)
  if (art === 'boden') teile.push(boden)
  if (art === 'spiegelung') teile.push(spiegel)
  if (art === 'kontakt_spiegelung') teile.push(schatten, spiegel)
  teile.push('Everything outside the product and this shadow is alpha 0 — a mottled grey area '
    + 'around the product is the typical failure of this request and makes the image unusable.')
  return teile.join('\n')
}

/**
 * Schatten auf einem ECHTEN Hintergrund (weiss, Studio …). Ohne Freistellen
 * funktioniert das bei beiden Modellfamilien gut — sofern die Physik genannt
 * ist, statt nur „mit Schatten".
 */
export function schattenKlausel(art: SchattenArt | null): string {
  if (!art || art === 'keiner') return ''
  const teile = ['SHADOW AND REFLECTION — describe them physically, render them cleanly.']
  if (art === 'kontakt' || art === 'kontakt_spiegelung') {
    teile.push('Contact shadow: one light direction, consistent with the highlights on the product. '
      + 'Darkest in a thin line exactly where the product meets the ground, then a soft, even '
      + 'falloff over roughly a tenth of the product\'s height. A smooth tonal gradient — never '
      + 'blotchy, mottled, grainy or cloud-like, and never floating away from the product.')
  }
  if (art === 'boden') {
    teile.push('Soft floor shadow: one even oval beneath the product, as under a large light from '
      + 'above, darkest at the centre and fading smoothly to the background tone.')
  }
  if (art === 'spiegelung' || art === 'kontakt_spiegelung') {
    teile.push('Reflection: the product mirrored in a glossy floor directly beneath its base, same '
      + 'perspective, fading smoothly to nothing within a third of its height. No ripples, no '
      + 'distortion, no second object.')
  }
  teile.push('The background around the shadow stays clean and even — no stains, no noise.')
  return teile.join('\n')
}

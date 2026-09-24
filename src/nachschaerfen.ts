// Nachschärfen: aus einem misslungenen Versuch einen besseren machen.
//
// Der wichtigste Entwurfsentscheid steht gleich am Anfang: Der ursprüngliche
// Prompt wird NICHT neu geschrieben. Er bleibt vollständig stehen — Legende,
// JSON, Identitätsklausel — und die Korrektur kommt als eigener Block ANS ENDE.
//
// Warum: Ein neu geschriebener Prompt verliert regelmässig Dinge, die vorher
// stimmten. Wer „die Jacke ist falsch" meldet, bekommt dann zwar die richtige
// Jacke, aber plötzlich ein anderes Gesicht. Die Korrektur soll genau das
// ändern, was benannt wurde, und sonst nichts. Ans Ende, weil beim Bildmodell
// das zuletzt Gelesene schwerer wiegt.

/** Ein benannter Mangel am erzeugten Bild. */
export interface Abweichung {
  /** Worum es geht — „Der Text auf der Titelseite". */
  was: string
  /** Was dort stehen müsste. */
  erwartet: string
  /** Was tatsächlich zu sehen ist. */
  gesehen: string
  schwere: 'leicht' | 'schwer'
}

export interface Pruefergebnis {
  bewertung: 'gut' | 'maengel' | 'falsch'
  zusammenfassung: string
  abweichungen: Abweichung[]
}

/**
 * Der Korrekturblock, der an den ursprünglichen Prompt gehängt wird.
 *
 * @param versuch      Die wievielte Nachbesserung das ist (2 = erster Nachschlag).
 * @param eigeneWorte  Was der Nutzer selbst bemängelt — wiegt am schwersten.
 * @param abweichungen Was die automatische Prüfung gefunden hat.
 * @param hatVorbild   Liegt das misslungene Bild als Referenz bei?
 */
export function korrekturBlock(
  versuch: number,
  eigeneWorte: string,
  abweichungen: Abweichung[],
  hatVorbild: boolean,
): string {
  const teile: string[] = [
    `CORRECTION PASS ${versuch} — THIS SECTION OVERRIDES EVERYTHING ABOVE.`,
    'A previous attempt at this exact brief was rejected. Everything above still applies; the '
    + 'points below are what went wrong and must be different this time. Change ONLY what is '
    + 'listed — everything that was already correct must survive unchanged.',
  ]

  if (hatVorbild) {
    teile.push(
      'THE LAST IMAGE ATTACHED IS THE REJECTED ATTEMPT, not a reference to copy and not part of '
      + 'the subject. Use it only to see what was wrong. Do not reproduce its mistakes, do not '
      + 'treat anything in it as a requirement, and never take a face, an object or wording from '
      + 'it — those come from the source material, as stated above.',
    )
  }

  // Der Nutzer zuerst: Was ein Mensch bemängelt, wiegt schwerer als jede
  // automatische Prüfung — er hat den Auftrag gestellt.
  if (eigeneWorte.trim()) {
    teile.push(`WHAT THE USER REJECTED — this is binding:\n"${eigeneWorte.trim()}"`)
  }

  const schwere = abweichungen.filter((a) => a.schwere === 'schwer')
  const leichte = abweichungen.filter((a) => a.schwere === 'leicht')

  if (schwere.length > 0) {
    teile.push('MUST BE FIXED:\n' + schwere.map((a, i) =>
      `${i + 1}. ${a.was} — required: ${a.erwartet}. In the rejected attempt: ${a.gesehen}.`,
    ).join('\n'))
  }
  if (leichte.length > 0) {
    teile.push('ALSO OFF, fix if it does not endanger the points above:\n' + leichte.map((a, i) =>
      `${i + 1}. ${a.was} — required: ${a.erwartet}. Seen: ${a.gesehen}.`,
    ).join('\n'))
  }

  teile.push(
    'Before finishing, check each point above against what you have produced. A second attempt '
    + 'that repeats the same mistake is worse than the first, because it proves the correction '
    + 'was ignored.',
  )

  return teile.join('\n\n')
}

/**
 * Setzt den Korrekturblock an den bisherigen Prompt.
 *
 * Der alte Korrekturblock eines vorherigen Durchgangs wird dabei ersetzt, nicht
 * angehängt: Sonst stapeln sich bei der dritten Runde drei widersprüchliche
 * Korrekturen, und das Modell weiss nicht mehr, welche gilt.
 */
export function mitKorrektur(prompt: string, block: string): string {
  const marke = /\n{0,2}CORRECTION PASS \d+ — THIS SECTION OVERRIDES EVERYTHING ABOVE\.[\s\S]*$/
  const sauber = prompt.replace(marke, '').trimEnd()
  return `${sauber}\n\n${block}`
}

/** Kurzfassung für die Oberfläche — was ist zu tun? */
export function befund(p: Pruefergebnis): string {
  if (p.bewertung === 'gut') return 'Passt zum Auftrag.'
  const schwer = p.abweichungen.filter((a) => a.schwere === 'schwer').length
  const leicht = p.abweichungen.length - schwer
  const teile: string[] = []
  if (schwer > 0) teile.push(`${schwer}× schwer`)
  if (leicht > 0) teile.push(`${leicht}× leicht`)
  return teile.length > 0 ? `Abweichungen: ${teile.join(', ')}` : p.zusammenfassung
}

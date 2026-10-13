// Der Volltext, der ans Bildmodell geht: Legende + JSON-Prompt + Klauseln am
// Ende (+ Korrektur). Eine Stelle für Web-App UND MCP-Server — zwei Fassungen
// dieses Aufbaus würden binnen Wochen auseinanderlaufen, und dann lieferte
// Claude über MCP andere Bilder als die Weboberfläche.

import type { RefBild, RefRolle } from './referenzen'
import { baueLegende, setzeManifest } from './referenzen'
import { identitaetsKlausel } from './identitaet'
import type { SchattenArt } from './schatten'
import type { SchattenQuelle } from './produkt'
import { brauchtIdentitaet, produktKlausel, freistellKlausel, schattenKlausel } from './produkt'
import { mitKorrektur } from './nachschaerfen'

export interface VolltextEingabe {
  /** Der JSON-Prompt (oder ein von Hand geschriebener Text). */
  prompt: string
  /** Die Referenzen in der verbindlichen Reihenfolge, die auch das Bildmodell sieht. */
  bilder: Array<RefBild & { faceLock?: boolean }>
  /** Treue zum Bauteil statt Gesicht — nur bei Foto-Retusche mit Produktfoto. */
  produktfoto: boolean
  /** Freigestellt ausgeben (nur wenn JEDES gewählte Modell es kann). */
  freistellen: boolean
  schattenArt: SchattenArt | null
  schattenQuelle: SchattenQuelle
  /** Korrekturblock eines Nachschärf-Durchgangs, kommt ganz ans Ende. */
  korrektur?: string
}

export function baueVolltext(e: VolltextEingabe): string {
  const nummernMit = (rolle: RefRolle) => e.bilder
    .map((b, i) => ({ b, nr: i + 1 })).filter((x) => x.b.rolle === rolle).map((x) => x.nr)

  // Legende VOR den Prompt, die Klauseln ANS ENDE — beim Bildmodell wiegt das
  // zuletzt Gelesene schwerer. Ein Gesicht nur, wenn überhaupt ein Mensch im
  // Spiel ist; beim Produktfoto stattdessen die Treue zum Teil.
  const legende = baueLegende(e.bilder)
  const mitMensch = brauchtIdentitaet(e.prompt,
    e.bilder.some((b) => b.rolle === 'person'), e.bilder.some((b) => b.faceLock))
  const klausel = [
    mitMensch
      ? identitaetsKlausel(nummernMit('ausgang'), nummernMit('ziel'))
      : e.produktfoto ? produktKlausel(nummernMit('ausgang')) : '',
    e.freistellen ? freistellKlausel(e.schattenQuelle, e.schattenArt) : schattenKlausel(e.schattenArt),
  ].filter(Boolean).join('\n\n')

  // `reference_images` deterministisch aus der echten Reihenfolge setzen —
  // sonst stehen zwei Listen im JSON, die sich widersprechen.
  const mitManifest = setzeManifest(e.prompt, e.bilder)
  const grundtext = [legende, mitManifest, klausel].filter(Boolean).join('\n\n')
  return e.korrektur ? mitKorrektur(grundtext, e.korrektur) : grundtext
}

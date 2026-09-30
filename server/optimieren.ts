import Anthropic from '@anthropic-ai/sdk'
import type { Request, Response } from 'express'
import { waehleAnbieter, GEMINI_PROMPT_MODELS } from './analyze.js'

// Prompt optimieren: aus einem misslungenen Versuch einen besseren PROMPT machen.
//
// Das Nachschärfen hängt eine Korrektur an den unveränderten Prompt — gut, wenn
// ein einzelner Punkt danebenlag. Liegt es aber am Prompt selbst (eine Angabe
// zu vage, zwei Anweisungen widersprechen sich, das Wichtigste steht versteckt
// zwischen Nebensachen), hilft ein Anhang wenig: Das Modell liest weiterhin den
// schwachen Text. Hier wird der Prompt deshalb gezielt überarbeitet.
//
// Die Gefahr dabei ist bekannt: Ein neu geschriebener Prompt verliert Dinge,
// die vorher stimmten. Deshalb (1) ausdrücklich nur gezielte Eingriffe, (2) die
// Einträge unter "preserve" werden danach hier im Code gegengeprüft und
// fehlende wieder eingesetzt.

const SYSTEM = `You improve a JSON prompt for an AI image model (GPT Image 2.5 or Nano Banana)
after it produced an unsatisfying image.

You receive: the reference images with their IMAGE number and role, the user's original brief,
the current JSON prompt, the image it produced (labelled REJECTED RESULT — always last), the
deviations found by a checker, and the user's own complaint.

STEP 1 — DIAGNOSE why the image model went wrong. Look for the cause IN THE PROMPT, not just the
symptom: an instruction that is vague ("with shadow", "several holes"), two instructions that
contradict each other, the decisive point buried among minor ones, a missing count, a missing
"negative" for exactly the failure that happened, a description of the reference that is wrong,
a request the model cannot fulfil in the way it is phrased.

STEP 2 — REVISE the prompt with targeted edits:
— Fix the causes you found. Make vague values concrete and measurable: counts, positions,
  directions, proportions ("darkest in a thin line where the part touches the ground, fading to
  zero within a tenth of its height"), exact colours.
— Resolve contradictions — decide in favour of the user's brief.
— Put the failure that just happened into "negative", in concrete words.
— The user's complaint is binding and outranks the checker.
— KEEP everything that was already right. Every "preserve" entry stays — you may make it more
  precise, never drop it. Keep the schema and its keys. Keep "reference_images" as it is.
— PRODUCTS: look at the source image yourself and make "preserve" countable — the number and
  layout of holes, threads, fins, ribs, slots and pockets (count them in the SOURCE image, never
  in the rejected result; count twice, and when you cannot be certain write "a row of fins"
  instead of a number — a wrong number is worse than none), the silhouette, the viewing angle, the
  finish and hue. Compare with the rejected result: every feature that differs gets named in
  "preserve" with the correct count and in "negative" with the wrong one.
— Do not invent a new creative direction. Stay under 3500 characters for the JSON prompt.
— Shadows on a transparent background: never ask for "shadow" loosely. Either the product
  alone with no shadow, or a shadow described as a smooth pure-black gradient in the alpha
  channel confined to a narrow band at the base. A mottled grey veil is the known failure.

OUTPUT — one JSON object, nothing else:
{
  "diagnose": "<one or two sentences in German: why the image went wrong>",
  "aenderungen": ["<each change you made, short, in German>"],
  "prompt": { <the complete revised JSON prompt> }
}`

interface Referenz { mimeType: string; data: string; rolle?: string; nummer?: number }

interface Abweichung { was: string; erwartet: string; gesehen: string; schwere?: string }

const ROLLE_KURZ: Record<string, string> = {
  ausgang: 'SOURCE MATERIAL — content and identity come from here',
  ziel: 'TARGET REFERENCE — look only',
  person: 'THE PERSON — this face must appear',
}

function ausDatenUrl(url: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(url.trim())
  return m ? { mimeType: m[1], data: m[2] } : null
}

function alsJson(text: string): Record<string, unknown> {
  const roh = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const start = roh.indexOf('{')
  const ende = roh.lastIndexOf('}')
  return JSON.parse(start >= 0 && ende > start ? roh.slice(start, ende + 1) : roh)
}

/**
 * Setzt "preserve"-Einträge wieder ein, die bei der Überarbeitung verloren
 * gingen. Verglichen wird über das Feld `what`: Wurde ein Eintrag nur genauer
 * gefasst, steht sein Kern meist noch drin; fehlt er ganz, kommt er zurück.
 */
export function sichereErhalt(alt: unknown, neu: Record<string, unknown>): string[] {
  const altListe = Array.isArray((alt as { preserve?: unknown })?.preserve)
    ? (alt as { preserve: Array<{ what?: string }> }).preserve : []
  if (altListe.length === 0) return []
  const neuListe = Array.isArray(neu.preserve) ? neu.preserve as Array<{ what?: string }> : []
  const neuText = neuListe.map((e) => JSON.stringify(e).toLowerCase()).join(' ')
  const zurueck: string[] = []
  for (const e of altListe) {
    const kern = (e.what ?? '').toLowerCase().split(/[^a-z0-9äöüß]+/).filter((w) => w.length > 3)
    // Mehr als die Hälfte der tragenden Wörter noch vorhanden → gilt als erhalten.
    const treffer = kern.filter((w) => neuText.includes(w)).length
    if (kern.length > 0 && treffer / kern.length > 0.5) continue
    neuListe.push(e)
    zurueck.push(e.what ?? '(ohne Titel)')
  }
  neu.preserve = neuListe
  return zurueck
}

export async function optimierePrompt(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as {
    prompt?: string
    auftrag?: string
    anmerkung?: string
    abweichungen?: Abweichung[]
    bild?: string
    referenzen?: Referenz[]
    freigestellt?: boolean
  }
  const promptText = body.prompt?.trim() ?? ''
  if (!promptText) {
    res.status(400).json({ error: 'Kein Prompt zum Optimieren' })
    return
  }
  let altJson: unknown = null
  try { altJson = alsJson(promptText) } catch { /* Freitext-Prompt — geht auch */ }

  const bild = body.bild ? ausDatenUrl(body.bild) : null
  const abw = (body.abweichungen ?? []).slice(0, 8)
  const kontext = [
    `THE USER'S ORIGINAL BRIEF:\n"${(body.auftrag ?? '').trim() || '(none given)'}"`,
    `THE CURRENT PROMPT:\n${promptText.slice(0, 12000)}`,
    abw.length > 0
      ? 'DEVIATIONS FOUND BY THE CHECKER:\n' + abw.map((a, i) =>
        `${i + 1}. [${a.schwere === 'schwer' ? 'severe' : 'minor'}] ${a.was} — required: ${a.erwartet}. Seen: ${a.gesehen}.`).join('\n')
      : 'DEVIATIONS FOUND BY THE CHECKER: none reported.',
    `THE USER'S COMPLAINT — binding:\n"${(body.anmerkung ?? '').trim() || '(none — work from the deviations and your own look at the result)'}"`,
    body.freigestellt ? 'The result was requested with a TRANSPARENT background and is shown flattened onto white.' : '',
  ].filter(Boolean).join('\n\n')

  try {
    const anbieter = waehleAnbieter()
    let text = ''

    if (anbieter === 'claude') {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const inhalt: Anthropic.ContentBlockParam[] = []
      for (const [i, r] of (body.referenzen ?? []).entries()) {
        inhalt.push({ type: 'text', text: `IMAGE ${r.nummer ?? i + 1}${r.rolle ? ` [${ROLLE_KURZ[r.rolle] ?? r.rolle}]` : ''}` })
        inhalt.push({ type: 'image', source: { type: 'base64', media_type: r.mimeType as 'image/jpeg', data: r.data } })
      }
      if (bild) {
        inhalt.push({ type: 'text', text: 'REJECTED RESULT:' })
        inhalt.push({ type: 'image', source: { type: 'base64', media_type: bild.mimeType as 'image/jpeg', data: bild.data } })
      }
      inhalt.push({ type: 'text', text: kontext })
      const stream = client.messages.stream({
        model: process.env.ANALYZE_MODEL?.trim() || 'claude-sonnet-5',
        max_tokens: 16000,
        system: SYSTEM,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: inhalt }],
      })
      const fertig = await stream.finalMessage()
      text = fertig.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    } else {
      const apiKey = process.env.GOOGLE_AI_API_KEY
      if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not configured on server')
      const teile: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = []
      for (const [i, r] of (body.referenzen ?? []).entries()) {
        teile.push({ text: `IMAGE ${r.nummer ?? i + 1}${r.rolle ? ` [${ROLLE_KURZ[r.rolle] ?? r.rolle}]` : ''}` })
        teile.push({ inlineData: { mimeType: r.mimeType, data: r.data } })
      }
      if (bild) {
        teile.push({ text: 'REJECTED RESULT:' })
        teile.push({ inlineData: bild })
      }
      teile.push({ text: kontext })

      let letzterFehler: unknown
      for (const modell of GEMINI_PROMPT_MODELS) {
        const antwort = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modell}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM }] },
              contents: [{ role: 'user', parts: teile }],
              generationConfig: {
                maxOutputTokens: 12000,
                temperature: 0.4,
                // Hier lohnt das Nachdenken: Gefragt ist eine Ursache, nicht
                // bloss eine Beschreibung.
                thinkingConfig: { thinkingLevel: 'high' },
                responseMimeType: 'application/json',
              },
            }),
          })
        if (!antwort.ok) {
          const roh = await antwort.text().catch(() => '')
          let meldung = `Gemini ${antwort.status}`
          try { meldung = JSON.parse(roh)?.error?.message ?? meldung } catch { /* Rohtext behalten */ }
          letzterFehler = new Error(meldung)
          if ([429, 404, 500, 503].includes(antwort.status)) continue
          throw letzterFehler
        }
        const daten = await antwort.json()
        text = (daten?.candidates?.[0]?.content?.parts ?? [])
          .filter((p: { thought?: boolean; text?: string }) => p?.thought !== true && typeof p.text === 'string')
          .map((p: { text: string }) => p.text).join('')
        break
      }
      if (!text) throw letzterFehler ?? new Error('Keine Antwort vom Modell')
    }

    const ergebnis = alsJson(text)
    const neu = ergebnis.prompt
    if (!neu || typeof neu !== 'object') throw new Error('Die Antwort enthielt keinen Prompt')
    const neuObjekt = neu as Record<string, unknown>
    const zurueck = sichereErhalt(altJson, neuObjekt)
    // Die Bildliste gehört nicht dem Optimierer — sie wird beim Generieren
    // ohnehin aus der tatsächlichen Reihenfolge gesetzt.
    const altBilder = (altJson as { reference_images?: unknown } | null)?.reference_images
    if (altBilder) neuObjekt.reference_images = altBilder

    const aenderungen = Array.isArray(ergebnis.aenderungen) ? ergebnis.aenderungen.map(String) : []
    if (zurueck.length > 0) {
      aenderungen.push(`Wieder eingesetzt, weil sie beim Umschreiben verloren gingen: ${zurueck.join('; ')}`)
    }
    res.json({
      prompt: JSON.stringify(neuObjekt, null, 2),
      diagnose: typeof ergebnis.diagnose === 'string' ? ergebnis.diagnose : '',
      aenderungen,
    })
  } catch (e) {
    const meldung = e instanceof Error ? e.message : 'Optimierung fehlgeschlagen'
    console.warn('[optimieren]', meldung)
    res.status(502).json({ error: meldung })
  }
}

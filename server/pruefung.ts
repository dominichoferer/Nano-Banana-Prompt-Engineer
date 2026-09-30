import type { Request, Response } from 'express'

// Das erzeugte Bild gegen den Auftrag halten.
//
// Ein Bildmodell sagt nie, dass es etwas nicht geschafft hat — es liefert immer
// ein Bild, und ob darauf steht, was stehen sollte, sieht bisher nur der
// Mensch. Diese Prüfung macht den Abgleich als eigenen Schritt: Referenzbilder,
// Auftragstext und Ergebnis gehen an ein Sehmodell, das benennt, was abweicht.
//
// Bewusst ein ANDERER Aufruf als die Generierung. Dasselbe Modell, das ein Bild
// erzeugt hat, ist ein schlechter Prüfer seiner eigenen Arbeit — es hat gerade
// begründet, warum das Ergebnis richtig ist.
//
// Läuft über Gemini: kostenloses Kontingent, und die Aufgabe ist Sehen und
// Vergleichen, nicht Urteilen über Geschmack.

const PRUEF_MODELLE = ['gemini-flash-latest', 'gemini-3-flash-preview']

const SYSTEM = `You compare a generated image against the brief it was produced from, and report
what does not match. You are a proof-reader, not a critic: taste is none of your business.

You receive, in this order:
  1. the reference images, each labelled with its IMAGE number and role
  2. the brief in the user's own words
  3. the prompt that was sent to the image model
  4. THE GENERATED IMAGE, labelled as such — always the last image

Answer with a single JSON object, no prose, no markdown fence:

{
  "bewertung": "gut" | "maengel" | "falsch",
  "zusammenfassung": "<one sentence in German, what is the state of this image>",
  "abweichungen": [
    { "was": "<what this is about, in German>",
      "erwartet": "<what the brief requires, in German>",
      "gesehen": "<what the image actually shows, in German>",
      "unbrauchbar": true | false }
  ]
}

HOW TO JUDGE
1. Only report what you can actually SEE. Never guess, never infer from the prompt what the image
   probably looks like. If something is too small or blurred to judge, say so in "gesehen" and
   mark it "leicht" — do not invent a deviation.
2. "unbrauchbar" is ONE question, answered per deviation: would the person who ordered this
   have to throw the image away and start again because of this point? Not "is it annoying" —
   would they have to DISCARD it. Answer true for:
   — a different person, or a face that is not the one in the SOURCE MATERIAL
   — invented, translated, garbled or re-typeset text where a reference supplied text
   — a missing, altered or invented logo
   — a different object than the one supplied, or the supplied object in a different colour
   — the requested change not carried out at all, or carried out on the wrong element
   — content that is largely unrelated to the references
   — a product with added, missing or merged holes, fins, slots or edges, or a changed silhouette
   — a shadow or haze that is mottled, grainy, blotchy, cloud- or smoke-like, or spread over the
     background — no client can use that, however good the product looks
   Do not answer false because the image itself looks competent — a well-made picture of the
   wrong thing is still the wrong thing, and it gets discarded all the same.
3. Answer false only when the image is usable and merely needs polish: framing a little tight, a
   mild colour cast, a clean shadow that is a little too strong or too weak, a slightly off
   proportion. In doubt, answer true — an unnecessary
   correction pass costs one run, a missed one costs the whole job.
3b. WORKED EXAMPLE. Reference: a red product on a grey background. Brief: "keep the product,
   make the background white". Generated: an all-blue surface.
   → { "was": "Farbgebung des Produkts", "erwartet": "Rot wie in IMAGE 1",
       "gesehen": "Durchgehend blaue Fläche, das Produkt fehlt", "unbrauchbar": true }
   The product's colour is part of the product. A blue picture cannot stand in for a red one, so
   this is discarded — true, not false.
4. TEXT AND LOGOS ARE THE MOST COMMON FAILURE. When a reference image carries text, compare it
   word for word with the generated image. Invented, translated, garbled or re-typeset wording is
   always "unbrauchbar": true, even when it looks plausible. Say WHICH words differ.
5. IDENTITY. When a reference marked SOURCE MATERIAL or THE PERSON shows a face, check that the
   generated face is that same person — not a similar one and not the person from a TARGET
   REFERENCE. A swapped identity is always "unbrauchbar": true.
6. A TARGET REFERENCE supplies look only. Its objects, garments and people appearing in the
   result is a deviation, not a success.
7. "bewertung": "gut" when the list is empty; "maengel" when every entry is false; "falsch" as
   soon as one entry is true.
8. Be concrete. "Colours are off" helps nobody; "the jacket is dark blue, the source shows it in
   black" does. Everything in German except the JSON keys.
9. PRODUCTS. When the source material is an object, compare it feature by feature: count holes,
   fins, ribs and slots in both images and name the numbers when they differ ("12 Bohrungen in
   IMAGE 1, 10 im Ergebnis"). Check the hue of coloured or anodised surfaces and the finish.
10. SHADOWS. A requested shadow must be a smooth tonal gradient touching the object. Look at the
   area around the object: grey speckles, noise, stains or a cloudy veil there are a deviation
   with "unbrauchbar": true, even when the brief asked for a shadow — they are not a shadow.
11. At most 6 entries. If there are more, report the six that matter most.`

interface Referenz {
  mimeType: string
  data: string
  rolle?: string
  nummer?: number
}

const ROLLE_KURZ: Record<string, string> = {
  ausgang: 'SOURCE MATERIAL — content and identity come from here',
  ziel: 'TARGET REFERENCE — look only',
  person: 'THE PERSON — this face must appear',
}

/** Trennt „data:image/png;base64,…" in Typ und Daten. */
function ausDatenUrl(url: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(url.trim())
  return m ? { mimeType: m[1], data: m[2] } : null
}

export async function pruefeErgebnis(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'GOOGLE_AI_API_KEY not configured on server' })
    return
  }

  const body = (req.body ?? {}) as {
    bild?: string
    referenzen?: Referenz[]
    auftrag?: string
    prompt?: string
    /** War das Ergebnis freigestellt? Dann liegt es hier auf Weiss. */
    freigestellt?: boolean
  }
  const bild = body.bild ? ausDatenUrl(body.bild) : null
  if (!bild) {
    res.status(400).json({ error: 'Kein Bild zum Prüfen' })
    return
  }

  const teile: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = []
  for (const [i, r] of (body.referenzen ?? []).entries()) {
    const rolle = r.rolle ? ` [${ROLLE_KURZ[r.rolle] ?? r.rolle}]` : ''
    teile.push({ text: `IMAGE ${r.nummer ?? i + 1}${rolle}` })
    teile.push({ inlineData: { mimeType: r.mimeType, data: r.data } })
  }
  teile.push({ text: `THE USER'S BRIEF:\n"${(body.auftrag ?? '').trim() || '(none given)'}"` })
  if (body.prompt?.trim()) {
    // Der Prompt wird gekürzt mitgegeben: Er hilft beim Einordnen, soll die
    // Prüfung aber nicht dominieren — beurteilt wird das BILD.
    teile.push({ text: `THE PROMPT THAT WAS SENT (for context only — judge the image, not the prompt):\n${body.prompt.slice(0, 6000)}` })
  }
  teile.push({ text: body.freigestellt
    ? 'THE GENERATED IMAGE — this is what you are judging. It was delivered with a TRANSPARENT '
      + 'background and is shown here flattened onto white: everything that is not pure white '
      + 'around the product was in the alpha channel. Grey speckles or a veil there are a defect.'
    : 'THE GENERATED IMAGE — this is what you are judging:' })
  teile.push({ inlineData: bild })

  let letzterFehler: unknown
  for (const modell of PRUEF_MODELLE) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modell}:generateContent?key=${apiKey}`
      const antwort = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: teile }],
          generationConfig: {
            maxOutputTokens: 4000,
            temperature: 0.2,
            // Beschreiben kann Flash mit wenig Nachdenken; die Frage, ob etwas
            // den Auftrag verfehlt, ist ein Urteil und braucht etwas mehr.
            thinkingConfig: { thinkingLevel: 'medium' },
            responseMimeType: 'application/json',
            // Das Schema wird erzwungen, nicht erbeten. Ohne es lieferte das
            // Modell zwar gültiges JSON, liess das Urteilsfeld aber einfach
            // weg — und eine fehlende Antwort wurde hier zu „leicht", also zum
            // Gegenteil dessen, was gemeint war.
            responseSchema: {
              type: 'OBJECT',
              properties: {
                zusammenfassung: { type: 'STRING' },
                abweichungen: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      was: { type: 'STRING' },
                      erwartet: { type: 'STRING' },
                      gesehen: { type: 'STRING' },
                      unbrauchbar: { type: 'BOOLEAN' },
                    },
                    required: ['was', 'erwartet', 'gesehen', 'unbrauchbar'],
                  },
                },
              },
              required: ['zusammenfassung', 'abweichungen'],
            },
          },
        }),
      })
      if (!antwort.ok) {
        const roh = await antwort.text().catch(() => '')
        let meldung = `Gemini ${antwort.status}`
        try { meldung = JSON.parse(roh)?.error?.message ?? meldung } catch { /* Rohtext behalten */ }
        throw Object.assign(new Error(meldung), { status: antwort.status })
      }
      const daten = await antwort.json()
      const text: string = (daten?.candidates?.[0]?.content?.parts ?? [])
        .filter((p: { thought?: boolean; text?: string }) => p?.thought !== true && typeof p.text === 'string')
        .map((p: { text: string }) => p.text).join('')
      const roh = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
      const ergebnis = JSON.parse(roh)

      // Die Bewertung wird hier neu abgeleitet statt dem Modell geglaubt: Es
      // schreibt gelegentlich „gut" und listet darunter schwere Abweichungen.
      // Die Ja/Nein-Antwort wird hier in die Schwere übersetzt. Nach einer
      // Kategorie („leicht" oder „schwer") zu fragen, hat nicht getragen: Das
      // Modell beschrieb eine komplett andere Farbe treffend und stufte sie
      // trotzdem als „leicht" ein. Eine einzelne Ja/Nein-Frage — müsste man das
      // Bild wegwerfen? — beantwortet es zuverlässig.
      const roh_abw: Array<{ was?: string; erwartet?: string; gesehen?: string; unbrauchbar?: boolean }> =
        Array.isArray(ergebnis.abweichungen) ? ergebnis.abweichungen.slice(0, 6) : []
      const abweichungen = roh_abw.map((a) => ({
        was: String(a.was ?? ''),
        erwartet: String(a.erwartet ?? ''),
        gesehen: String(a.gesehen ?? ''),
        schwere: a.unbrauchbar === true ? 'schwer' : 'leicht',
      }))
      const hatSchwere = abweichungen.some((a) => a.schwere === 'schwer')
      const bewertung = hatSchwere ? 'falsch' : abweichungen.length > 0 ? 'maengel' : 'gut'

      res.json({
        bewertung,
        zusammenfassung: typeof ergebnis.zusammenfassung === 'string' ? ergebnis.zusammenfassung : '',
        abweichungen,
      })
      return
    } catch (e) {
      const status = (e as { status?: number })?.status
      const wiederholbar = status === 429 || status === 404 || status === 500 || status === 503
      const hatNaechstes = modell !== PRUEF_MODELLE[PRUEF_MODELLE.length - 1]
      if (wiederholbar && hatNaechstes) {
        console.warn(`[pruefung] ${modell} nicht verfügbar (${status}), versuche nächstes Modell…`)
        letzterFehler = e
        continue
      }
      const meldung = e instanceof Error ? e.message : 'Fehler'
      console.warn('[pruefung]', meldung)
      res.status(502).json({ error: meldung })
      return
    }
  }
  res.status(502).json({ error: letzterFehler instanceof Error ? letzterFehler.message : 'Prüfung fehlgeschlagen' })
}

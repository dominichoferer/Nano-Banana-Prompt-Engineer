// HERON AI Studio als MCP-Server — dieselben Werkzeuge wie die Weboberfläche,
// direkt für Claude Code und Claude Desktop.
//
// Aufbau: Die Express-App aus api/index.ts läuft hier IM SELBEN PROZESS auf
// einem freien Port von 127.0.0.1, und die Werkzeuge rufen ihre Endpunkte auf.
// Dadurch gibt es keine zweite Fassung von Prompt-Schreiber, Generierung,
// Prüfung und Optimierung — Claude bekommt exakt das, was die Web-App liefert.
// Den Volltext (Legende, Klauseln, Korrektur) baut src/volltext.ts, ebenfalls
// gemeinsam mit der App.
//
// Läuft lokal ohne Anmeldung: Ohne AUTH_USERS/AUTH_SECRET in der .env ist die
// Anmeldung „aus", und ausserhalb des Betriebs (kein VERCEL, kein production)
// lässt requireAuth dann durch. Der Port lauscht nur auf 127.0.0.1.

// ── stdout gehört dem Protokoll ─────────────────────────────────────────────
// Über stdio spricht der Server JSON-RPC. Jede andere Zeile auf stdout — ein
// console.log aus den Server-Modulen, die Meldung von dotenv — zerstört die
// Verbindung. Deshalb geht alles Protokollieren nach stderr, und zwar BEVOR
// irgendein anderes Modul geladen wird.
console.log = (...a: unknown[]) => console.error(...a)
console.info = (...a: unknown[]) => console.error(...a)

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { PNG } from 'pngjs'
import dotenv from 'dotenv'

import type { RefRolle } from '../src/referenzen'
import { begrenze } from '../src/referenzen'
import { willGesichtLock } from '../src/identitaet'
import type { SchattenArt } from '../src/schatten'
import { rendereSchatten, SCHATTEN_STANDARD, schattenAusAuftrag } from '../src/schatten'
import type { Abweichung } from '../src/nachschaerfen'
import { korrekturBlock } from '../src/nachschaerfen'
import { baueVolltext } from '../src/volltext'

const run = promisify(execFile)

// Das Projekt liegt zwei Ebenen über der gebauten Datei (mcp/dist/…) bzw. eine
// über dieser Quelle (mcp/…). HERON_STUDIO_DIR überstimmt beides.
const HIER = path.dirname(fileURLToPath(import.meta.url))
const PROJEKT = process.env.HERON_STUDIO_DIR
  ?? [path.resolve(HIER, '..'), path.resolve(HIER, '../..')].find((p) => existsSync(path.join(p, '.env')))
  ?? path.resolve(HIER, '..')
dotenv.config({ path: path.join(PROJEKT, '.env'), quiet: true })

const AUSGABE_STANDARD = path.join(homedir(), 'Pictures', 'HERON AI Studio')
const MAX_KANTE = 1600

// ── Die Web-App im Prozess starten ──────────────────────────────────────────

let basis: Promise<string> | null = null
function apiBasis(): Promise<string> {
  basis ??= (async () => {
    const { default: app } = await import('../api/index.js')
    return new Promise<string>((fertig) => {
      const srv = app.listen(0, '127.0.0.1', () => {
        fertig(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`)
      })
    })
  })()
  return basis
}

async function postJson<T>(pfad: string, body: unknown): Promise<T> {
  const res = await fetch(`${await apiBasis()}${pfad}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const daten = await res.json().catch(() => ({})) as T & { error?: string }
  if (!res.ok) throw new Error(daten.error ?? `${pfad}: HTTP ${res.status}`)
  return daten
}

// ── Bilder ──────────────────────────────────────────────────────────────────

interface Bildteil { mimeType: string; data: string }

function pfadAuf(p: string): string {
  const voll = path.resolve(p.replace(/^~(?=$|\/)/, homedir()))
  if (!existsSync(voll)) throw new Error(`Datei nicht gefunden: ${p}`)
  return voll
}

/**
 * Ein Bild für die Modelle aufbereiten: höchstens `kante` lang, PNG bleibt PNG
 * (sonst ginge die Transparenz eines freigestellten Produkts verloren), alles
 * andere — auch HEIC vom iPhone — wird JPEG. Erledigt `sips`, das auf jedem
 * Mac vorhanden ist.
 */
async function bildteil(pfad: string, kante = MAX_KANTE): Promise<Bildteil> {
  const quelle = pfadAuf(pfad)
  const istPng = /\.png$/i.test(quelle)
  const tmp = await mkdtemp(path.join(tmpdir(), 'heron-mcp-'))
  const ziel = path.join(tmp, istPng ? 'b.png' : 'b.jpg')
  try {
    await run('sips', ['-Z', String(kante), '-s', 'format', istPng ? 'png' : 'jpeg',
      ...(istPng ? [] : ['-s', 'formatOptions', '88']), quelle, '--out', ziel])
    return { mimeType: istPng ? 'image/png' : 'image/jpeg', data: (await readFile(ziel)).toString('base64') }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** PNG auf Weiss setzen — für Vorschau und Prüfung eines freigestellten Bildes. */
function aufWeiss(png: Buffer): Buffer {
  const b = PNG.sync.read(png)
  for (let i = 0; i < b.data.length; i += 4) {
    const a = b.data[i + 3] / 255
    b.data[i] = b.data[i] * a + 255 * (1 - a)
    b.data[i + 1] = b.data[i + 1] * a + 255 * (1 - a)
    b.data[i + 2] = b.data[i + 2] * a + 255 * (1 - a)
    b.data[i + 3] = 255
  }
  return PNG.sync.write(b)
}

/** Kleine JPEG-Vorschau, damit Claude das Ergebnis selbst sehen kann. */
async function vorschau(pfad: string, kante = 1024): Promise<Bildteil> {
  const tmp = await mkdtemp(path.join(tmpdir(), 'heron-mcp-'))
  try {
    let quelle = pfad
    if (/\.png$/i.test(pfad)) {
      quelle = path.join(tmp, 'weiss.png')
      await writeFile(quelle, aufWeiss(await readFile(pfad)))
    }
    const ziel = path.join(tmp, 'v.jpg')
    await run('sips', ['-Z', String(kante), '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', quelle, '--out', ziel])
    return { mimeType: 'image/jpeg', data: (await readFile(ziel)).toString('base64') }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

function endung(mime: string): string {
  return mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
}

function zeitstempel(): string {
  const d = new Date()
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
}

async function ausgabeOrdner(wunsch?: string): Promise<string> {
  const ordner = wunsch
    ? path.resolve(wunsch.replace(/^~(?=$|\/)/, homedir()))
    : path.join(AUSGABE_STANDARD, new Date().toISOString().slice(0, 10))
  await mkdir(ordner, { recursive: true })
  return ordner
}

// ── Gemeinsame Schemata ─────────────────────────────────────────────────────

const ROLLE = z.enum(['ausgang', 'ziel', 'person']).describe(
  'ausgang = Ausgangsmaterial: woraus das Ergebnis entsteht, wird originalgetreu übernommen (Produkt, Person). '
  + 'ziel = Zielreferenz: nur der Look (Licht, Farbe, Perspektive, Ausschnitt), nie deren Inhalt oder Personen. '
  + 'person = Porträt, dessen Gesicht im Ergebnis stehen muss.')

const BILDER = z.array(z.object({
  pfad: z.string().describe('Absoluter Pfad zur Bilddatei (jpg, png, webp, heic)'),
  rolle: ROLLE.default('ausgang'),
  gesicht_lock: z.boolean().optional().describe('Gesicht dieses Bildes pixelgenau übernehmen'),
})).max(16).default([]).describe('Referenzbilder. Reihenfolge ist egal — sortiert wird nach Rolle (ausgang, ziel, person), genau wie in der Web-App.')

const MODELL = z.enum(['nb21', 'pro', 'flash', 'flare', 'sunburst', 'openai']).describe(
  'nb21 = Nano Banana 2.1 (Standard, günstig, schnell) · pro = Nano Banana Pro · flash = Nano Banana 2 (abgekündigt) · '
  + 'flare = GPT Image 2.5 Flare · sunburst = GPT Image 2.5 Sunburst (höchste Kontrolle) · openai = gpt-image-2')

const SCHATTEN = z.enum(['keiner', 'kontakt', 'boden', 'spiegelung', 'kontakt_spiegelung'])

type BildEintrag = { pfad: string; rolle: RefRolle; gesicht_lock?: boolean }

const ROLLEN_ORDNUNG: RefRolle[] = ['ausgang', 'ziel', 'person']
/** Dieselbe Reihenfolge wie in der Web-App — die Nummern im Prompt hängen daran. */
function ordne(bilder: BildEintrag[]): BildEintrag[] {
  return begrenze([...bilder].sort((a, b) => ROLLEN_ORDNUNG.indexOf(a.rolle) - ROLLEN_ORDNUNG.indexOf(b.rolle)))
}

async function referenzen(bilder: BildEintrag[], kante = MAX_KANTE) {
  return Promise.all(ordne(bilder).map(async (b, i) => ({
    ...(await bildteil(b.pfad, kante)), rolle: b.rolle, nummer: i + 1,
    zeigt: path.basename(b.pfad), faceLock: Boolean(b.gesicht_lock),
  })))
}

function text(t: string) {
  return { type: 'text' as const, text: t }
}
function bild(b: Bildteil) {
  return { type: 'image' as const, data: b.data, mimeType: b.mimeType }
}
function fehler(e: unknown) {
  return { isError: true, content: [text(`Fehler: ${e instanceof Error ? e.message : String(e)}`)] }
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: 'heron-studio', version: '1.0.0' },
  {
    instructions:
      'HERON AI Studio: Prompts für Bildmodelle schreiben, Bilder generieren (Nano Banana, GPT Image), '
      + 'Ergebnisse prüfen, Prompts optimieren und Schatten auf freigestellte Produkte legen.\n'
      + 'Üblicher Ablauf: prompt_schreiben → bild_generieren → (bild_pruefen) → bei Mängeln prompt_optimieren '
      + 'oder bild_generieren mit korrektur → bei freigestellten Produkten schatten_setzen.\n'
      + 'Freigestellt mit Schatten: Den Schatten NICHT vom Modell malen lassen (kommt fleckig), sondern '
      + 'freigestellt=true mit schatten_quelle="app" — das Werkzeug legt dann einen glatten Schatten darunter.\n'
      + 'Bilder werden standardmässig unter ~/Pictures/HERON AI Studio/<Datum>/ gespeichert; jedes Werkzeug '
      + 'nennt die Pfade. Alle Texte an den Nutzer auf Deutsch.',
  },
)

server.registerTool('prompt_schreiben', {
  title: 'Prompt schreiben',
  description: 'Schreibt aus Referenzbildern und einem Auftrag einen strukturierten JSON-Prompt für die Bildmodelle '
    + '— derselbe Prompt-Schreiber wie in der Web-App (Rollen, Gesicht-/Produkttreue, Schattenphysik). '
    + 'Das Ergebnis direkt an bild_generieren übergeben.',
  inputSchema: {
    auftrag: z.string().describe('Was entstehen soll, in eigenen Worten (Deutsch ist ok)'),
    bilder: BILDER,
    modus: z.enum(['retouch', 'mockup', 'generation']).default('retouch')
      .describe('retouch = Foto-Retusche (Vorlage bleibt Basis) · mockup = Artwork auf ein Objekt · generation = neues Bild, Referenzen nur Stil'),
    produktfoto: z.boolean().default(false)
      .describe('Nur bei retouch: Produkt/Bauteil statt Person — Bohrungen, Rippen, Oberfläche, Gravuren werden gezählt und festgehalten'),
    aenderungen: z.array(z.enum(['pose', 'lighting', 'color', 'background'])).optional()
      .describe('Bei retouch: welche Bereiche global geändert werden dürfen'),
    mockup_art: z.enum(['folder', 'flyer', 'billboard', 'webseite', 'tshirt', 'tasse', 'buch', 'visitenkarte', 'flasche', 'verpackung']).optional(),
    umfeld: z.enum(['light', 'dark']).optional().describe('Bei mockup: helles oder dunkles Studio'),
  },
}, async (a) => {
  try {
    if (a.bilder.length === 0 && a.modus !== 'generation') throw new Error('Ohne Referenzbild geht nur modus "generation".')
    const geordnet = ordne(a.bilder as BildEintrag[])
    const gesichtErzwungen = willGesichtLock(a.auftrag)
    const fd = new FormData()
    for (const b of geordnet) {
      const t = await bildteil(b.pfad)
      fd.append('images', new Blob([Buffer.from(t.data, 'base64')], { type: t.mimeType }), path.basename(b.pfad))
    }
    fd.append('imageSettings', JSON.stringify(geordnet.map((b) => ({
      name: path.basename(b.pfad), rolle: b.rolle,
      faceLock: Boolean(b.gesicht_lock) || (gesichtErzwungen && b.rolle === 'ausgang'),
      objectLock: false, customLock: '',
    }))))
    if (a.auftrag.trim()) fd.append('userDescription', a.auftrag.trim())
    fd.append('promptMode', a.modus)
    if (a.modus === 'retouch' && a.produktfoto) fd.append('produktfoto', '1')
    if (a.aenderungen?.length) fd.append('changeAreas', a.aenderungen.join(','))
    if (a.modus === 'mockup' && a.mockup_art) fd.append('mockupType', a.mockup_art)
    if (a.modus === 'mockup' && a.umfeld) fd.append('mockupEnvironment', a.umfeld)

    const res = await fetch(`${await apiBasis()}/api/analyze`, { method: 'POST', body: fd })
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(d.error ?? `HTTP ${res.status}`)
    }
    let prompt = ''
    for (const zeile of (await res.text()).split('\n')) {
      if (!zeile.startsWith('data:')) continue
      try {
        const e = JSON.parse(zeile.slice(5))
        if (e.type === 'text') prompt += e.text
        if (e.type === 'error') throw new Error(e.error)
      } catch (err) {
        if (err instanceof Error && !(err instanceof SyntaxError)) throw err
      }
    }
    prompt = prompt.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    if (!prompt) throw new Error('Der Prompt-Schreiber hat nichts geliefert.')
    return { content: [text(prompt)] }
  } catch (e) {
    return fehler(e)
  }
})

server.registerTool('bild_generieren', {
  title: 'Bild generieren',
  description: 'Erzeugt Bilder aus einem Prompt (am besten dem JSON aus prompt_schreiben) mit denselben Referenzbildern. '
    + 'Speichert jedes Bild als Datei, legt den gesendeten Prompt als .txt daneben und zeigt eine Vorschau. '
    + 'Mit korrektur wird nachgeschärft: Der Prompt bleibt, die Korrektur kommt ans Ende.',
  inputSchema: {
    prompt: z.string().describe('Der Prompt — JSON aus prompt_schreiben oder eigener Text'),
    bilder: BILDER,
    modelle: z.array(MODELL).min(1).default(['nb21']).describe('Jedes Modell rechnet denselben Auftrag'),
    aufloesung: z.enum(['1K', '2K', '4K', 'auto']).default('2K').describe('auto nur bei GPT-Modellen'),
    seitenverhaeltnis: z.string().default('1:1').describe('z. B. 1:1, 16:9, 9:16, 4:3, 3:4, 4:5, 5:4; GPT zusätzlich 3:2, 2:3; auto'),
    ausgabeformat: z.enum(['auto', 'png', 'jpeg']).default('auto').describe('Nur GPT-Modelle'),
    freigestellt: z.boolean().default(false).describe('Transparenter Hintergrund — nur flare und sunburst'),
    produktfoto: z.boolean().default(false).describe('Produkttreue-Klausel ans Ende (Bohrungen, Oberfläche, Gravuren exakt)'),
    schatten: SCHATTEN.optional().describe('Schatten/Spiegelung. Ohne Angabe: aus dem Prompt abgeleitet, falls produktfoto'),
    schatten_quelle: z.enum(['app', 'modell']).default('app')
      .describe('Bei freigestellt: app = Modell stellt nur frei, Schatten wird danach sauber gerechnet (empfohlen) · modell = Modell malt ihn selbst'),
    varianten: z.number().int().min(1).max(3).default(1),
    korrektur: z.object({
      anmerkung: z.string().default('').describe('Was am letzten Ergebnis falsch war'),
      abweichungen: z.array(z.object({
        was: z.string(), erwartet: z.string(), gesehen: z.string(),
        schwere: z.enum(['leicht', 'schwer']).default('schwer'),
      })).default([]).describe('Abweichungen aus bild_pruefen'),
      abgelehntes_bild: z.string().optional().describe('Pfad zum misslungenen Ergebnis — geht als Gegenbeispiel mit'),
      versuch: z.number().int().min(2).default(2),
    }).optional(),
    ausgabe_ordner: z.string().optional().describe('Standard: ~/Pictures/HERON AI Studio/<Datum>'),
    dateiname: z.string().optional().describe('Präfix der Dateinamen'),
  },
}, async (a) => {
  try {
    const transparenzOk = a.modelle.every((m) => m === 'flare' || m === 'sunburst')
    if (a.freigestellt && !transparenzOk) {
      throw new Error('Freigestellt können nur flare und sunburst — für Nano Banana bitte freigestellt=false.')
    }
    const refs = await referenzen(a.bilder as BildEintrag[])
    const schattenArt: SchattenArt | null = a.schatten
      ?? (a.produktfoto ? schattenAusAuftrag(a.prompt) : null)

    let korrekturText: string | undefined
    let vorbild: Bildteil | null = null
    if (a.korrektur) {
      vorbild = a.korrektur.abgelehntes_bild ? await bildteil(a.korrektur.abgelehntes_bild, 900) : null
      korrekturText = korrekturBlock(a.korrektur.versuch, a.korrektur.anmerkung,
        a.korrektur.abweichungen as Abweichung[], Boolean(vorbild))
    }
    const volltext = baueVolltext({
      prompt: a.prompt,
      bilder: refs,
      produktfoto: a.produktfoto,
      freistellen: a.freigestellt,
      schattenArt,
      schattenQuelle: a.schatten_quelle,
      korrektur: korrekturText,
    })
    const anModell = [...refs.map(({ mimeType, data }) => ({ mimeType, data })), ...(vorbild ? [vorbild] : [])]

    const ordner = await ausgabeOrdner(a.ausgabe_ordner)
    const praefix = (a.dateiname ?? 'heron').replace(/[^\wäöüÄÖÜß.-]+/g, '-')
    const stempel = zeitstempel()
    await writeFile(path.join(ordner, `${praefix}_${stempel}_prompt.txt`), volltext)

    const inhalt: Array<ReturnType<typeof text> | ReturnType<typeof bild>> = []
    const zeilen: string[] = []
    for (let v = 1; v <= a.varianten; v++) {
      for (const modell of a.modelle) {
        const name = `${praefix}_${stempel}_${modell}${a.varianten > 1 ? `_v${v}` : ''}`
        try {
          const d = await postJson<{ image: string; model: string }>('/api/generate', {
            prompt: volltext, model: modell, resolution: a.aufloesung, aspectRatio: a.seitenverhaeltnis,
            outputFormat: modell === 'flare' || modell === 'sunburst' || modell === 'openai' ? a.ausgabeformat : undefined,
            transparent: a.freigestellt || undefined,
            referenceImages: anModell.length > 0 ? anModell : undefined,
          })
          const m = /^data:([^;]+);base64,(.+)$/s.exec(d.image)
          if (!m) throw new Error('Unerwartete Bildantwort')
          const datei = path.join(ordner, `${name}.${endung(m[1])}`)
          await writeFile(datei, Buffer.from(m[2], 'base64'))
          zeilen.push(`✓ ${d.model}: ${datei}`)
          inhalt.push(bild(await vorschau(datei)))

          // Freigestellt + Schatten von der App: gleich mitrechnen.
          if (a.freigestellt && a.schatten_quelle === 'app' && schattenArt && schattenArt !== 'keiner' && datei.endsWith('.png')) {
            const mitSchatten = datei.replace(/\.png$/, `_${schattenArt}.png`)
            await schattenAufDatei(datei, mitSchatten, { ...SCHATTEN_STANDARD, art: schattenArt })
            zeilen.push(`  ↳ mit Schatten (${schattenArt}): ${mitSchatten}`)
            inhalt.push(bild(await vorschau(mitSchatten)))
          }
        } catch (e) {
          zeilen.push(`✗ ${modell}${a.varianten > 1 ? ` (Variante ${v})` : ''}: ${e instanceof Error ? e.message : e}`)
        }
      }
    }
    zeilen.push(`Gesendeter Prompt: ${path.join(ordner, `${praefix}_${stempel}_prompt.txt`)}`)
    return { content: [text(zeilen.join('\n')), ...inhalt] }
  } catch (e) {
    return fehler(e)
  }
})

server.registerTool('bild_pruefen', {
  title: 'Bild prüfen',
  description: 'Hält ein erzeugtes Bild gegen Referenzen und Auftrag und listet die Abweichungen (schwer = Bild unbrauchbar). '
    + 'Die Abweichungen lassen sich an prompt_optimieren oder bild_generieren.korrektur weitergeben.',
  inputSchema: {
    bild: z.string().describe('Pfad zum erzeugten Bild'),
    bilder: BILDER,
    auftrag: z.string().default(''),
    prompt: z.string().optional().describe('Der gesendete Prompt, zur Einordnung'),
    freigestellt: z.boolean().default(false),
    schatten_von_app: z.boolean().default(false)
      .describe('true, wenn das Bild bewusst ohne Schatten generiert wurde, weil schatten_setzen ihn danach legt — dann ist ein fehlender Schatten kein Mangel'),
  },
}, async (a) => {
  try {
    const roh = pfadAuf(a.bild)
    const tmp = await mkdtemp(path.join(tmpdir(), 'heron-mcp-'))
    let pruefbild: Bildteil
    try {
      let quelle = roh
      if (/\.png$/i.test(roh)) {
        quelle = path.join(tmp, 'w.png')
        await writeFile(quelle, aufWeiss(await readFile(roh)))
      }
      pruefbild = await bildteil(quelle, 1100)
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
    const refs = await referenzen(a.bilder as BildEintrag[], 1100)
    const d = await postJson<{ bewertung: string; zusammenfassung: string; abweichungen: Abweichung[] }>('/api/pruefen', {
      bild: `data:${pruefbild.mimeType};base64,${pruefbild.data}`,
      referenzen: refs.map(({ mimeType, data, rolle, nummer }) => ({ mimeType, data, rolle, nummer })),
      auftrag: a.auftrag,
      prompt: a.prompt?.slice(0, 6000),
      freigestellt: a.freigestellt,
      schattenSpaeter: a.schatten_von_app,
    })
    return { content: [text(JSON.stringify(d, null, 2))] }
  } catch (e) {
    return fehler(e)
  }
})

server.registerTool('prompt_optimieren', {
  title: 'Prompt optimieren',
  description: 'Überarbeitet einen Prompt gezielt, nachdem ein Ergebnis nicht getaugt hat: findet die Ursache im Prompt, '
    + 'macht vage Angaben messbar, behält alles, was schon stimmte. Liefert den neuen Prompt, die Ursache und die Änderungen.',
  inputSchema: {
    prompt: z.string(),
    bild: z.string().describe('Pfad zum misslungenen Ergebnis'),
    bilder: BILDER,
    auftrag: z.string().default(''),
    anmerkung: z.string().default('').describe('Was dir am Ergebnis nicht passt — wiegt am schwersten'),
    abweichungen: z.array(z.object({
      was: z.string(), erwartet: z.string(), gesehen: z.string(),
      schwere: z.enum(['leicht', 'schwer']).default('schwer'),
    })).default([]),
    freigestellt: z.boolean().default(false),
  },
}, async (a) => {
  try {
    const roh = pfadAuf(a.bild)
    const ergebnisBild = /\.png$/i.test(roh)
      ? { mimeType: 'image/png', data: aufWeiss(await readFile(roh)).toString('base64') }
      : await bildteil(roh, 1100)
    const refs = await referenzen(a.bilder as BildEintrag[], 1100)
    const d = await postJson<{ prompt: string; diagnose: string; aenderungen: string[] }>('/api/optimieren', {
      prompt: a.prompt,
      auftrag: a.auftrag,
      anmerkung: a.anmerkung,
      abweichungen: a.abweichungen,
      bild: `data:${ergebnisBild.mimeType};base64,${ergebnisBild.data}`,
      referenzen: refs.map(({ mimeType, data, rolle, nummer }) => ({ mimeType, data, rolle, nummer })),
      freigestellt: a.freigestellt,
    })
    return {
      content: [
        text(`Ursache: ${d.diagnose}\n\nÄnderungen:\n${d.aenderungen.map((x) => `– ${x}`).join('\n')}`),
        text(d.prompt),
      ],
    }
  } catch (e) {
    return fehler(e)
  }
})

async function schattenAufDatei(quelle: string, ziel: string, opt: typeof SCHATTEN_STANDARD): Promise<void> {
  let roh = await readFile(quelle)
  if (!/\.png$/i.test(quelle)) {
    const tmp = await mkdtemp(path.join(tmpdir(), 'heron-mcp-'))
    try {
      await run('sips', ['-s', 'format', 'png', quelle, '--out', path.join(tmp, 'p.png')])
      roh = await readFile(path.join(tmp, 'p.png'))
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }
  const png = PNG.sync.read(roh)
  const aus = rendereSchatten({
    breite: png.width, hoehe: png.height, daten: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
  }, opt)
  const neu = new PNG({ width: aus.breite, height: aus.hoehe })
  Buffer.from(aus.daten.buffer, aus.daten.byteOffset, aus.daten.length).copy(neu.data)
  await writeFile(ziel, PNG.sync.write(neu))
}

server.registerTool('schatten_setzen', {
  title: 'Schatten setzen',
  description: 'Legt einen glatten Kontaktschatten, Bodenschatten oder eine Spiegelung unter ein FREIGESTELLTES Produkt '
    + '(PNG mit transparentem Hintergrund) und entfernt dabei Grauschleier/Flecken, die ein Modell in den Alphakanal gerauscht hat. '
    + 'Das Produkt selbst bleibt pixelgleich. art="keiner" säubert nur.',
  inputSchema: {
    bild: z.string().describe('Pfad zum freigestellten PNG'),
    art: SCHATTEN.default('kontakt'),
    staerke: z.number().min(0).max(1).default(SCHATTEN_STANDARD.staerke),
    weichheit: z.number().min(0).max(1).default(SCHATTEN_STANDARD.weichheit),
    laenge: z.number().min(0).max(1).default(SCHATTEN_STANDARD.laenge).describe('Länge der Spiegelung (Anteil der Produkthöhe)'),
    schleier_entfernen: z.boolean().default(true),
    ziel: z.string().optional().describe('Zielpfad; Standard: neben dem Original mit Suffix'),
  },
}, async (a) => {
  try {
    const quelle = pfadAuf(a.bild)
    const ziel = a.ziel
      ? path.resolve(a.ziel.replace(/^~(?=$|\/)/, homedir()))
      : quelle.replace(/\.[^.]+$/, `_${a.art}.png`)
    await schattenAufDatei(quelle, ziel, {
      art: a.art, staerke: a.staerke, weichheit: a.weichheit, laenge: a.laenge, schleierEntfernen: a.schleier_entfernen,
    })
    return { content: [text(`Gespeichert: ${ziel}`), bild(await vorschau(ziel))] }
  } catch (e) {
    return fehler(e)
  }
})

await server.connect(new StdioServerTransport())
console.error(`[heron-studio] bereit — Projekt: ${PROJEKT}`)

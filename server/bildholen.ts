import type { Request, Response } from 'express'
import { lookup } from 'dns/promises'
import { isIP } from 'net'

// Bild von einer Adresse holen, serverseitig.
//
// Wozu: Beim Einfügen aus dem Browser liegt oft kein Bild in der
// Zwischenablage, sondern nur ein Verweis darauf — etwa wenn man in einer
// Webseite einen Ausschnitt markiert und kopiert. Der Browser darf so eine
// fremde Adresse wegen CORS meist nicht selbst laden; der Server darf es.
//
// Ein Endpunkt, der beliebige Adressen abruft, ist eine bekannte Schwachstelle
// (SSRF): Ein Angreifer liesse damit den Server interne Dienste abfragen, an
// die er selbst nicht herankommt — Metadaten-Dienste der Cloud, Datenbanken im
// selben Netz, localhost. Deshalb ist hier alles verboten, was nicht
// ausdrücklich erlaubt ist:
//
//   · nur http und https
//   · keine privaten, lokalen oder Link-Local-Adressen, auch nicht über eine
//     Umleitung — jede Station wird neu geprüft
//   · höchstens drei Umleitungen
//   · nur Antworten, die sich selbst als Bild ausgeben
//   · harte Obergrenze für die Grösse, auch wenn die Gegenstelle lügt
//   · Zeitlimit
//
// Der Endpunkt hängt ausserdem hinter requireAuth, ist also nur für angemeldete
// Nutzer erreichbar.

const MAX_BYTES = 20 * 1024 * 1024
const MAX_UMLEITUNGEN = 3
const ZEITLIMIT_MS = 10_000

/** Adressen, an die der Server niemals eine Anfrage schicken darf. */
function istInterneAdresse(ip: string): boolean {
  const art = isIP(ip)
  if (art === 4) {
    const t = ip.split('.').map(Number)
    if (t[0] === 10) return true                                  // 10.0.0.0/8
    if (t[0] === 127) return true                                 // Loopback
    if (t[0] === 0) return true                                   // 0.0.0.0/8
    if (t[0] === 169 && t[1] === 254) return true                 // Link-Local, Cloud-Metadaten
    if (t[0] === 172 && t[1] >= 16 && t[1] <= 31) return true     // 172.16.0.0/12
    if (t[0] === 192 && t[1] === 168) return true                 // 192.168.0.0/16
    if (t[0] === 100 && t[1] >= 64 && t[1] <= 127) return true    // Carrier-Grade NAT
    if (t[0] >= 224) return true                                  // Multicast und höher
    return false
  }
  if (art === 6) {
    const k = ip.toLowerCase()
    if (k === '::1' || k === '::') return true
    if (k.startsWith('fe80')) return true                         // Link-Local
    if (k.startsWith('fc') || k.startsWith('fd')) return true     // Unique Local
    // IPv4 in IPv6-Schreibweise nicht als Umweg zulassen. Node schreibt
    // „::ffff:127.0.0.1" beim Normalisieren in „::ffff:7f00:1" um — beide
    // Formen müssen erkannt werden, sonst rutscht Loopback durch.
    const punkte = k.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (punkte) return istInterneAdresse(punkte[1])
    const hex = k.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex) {
      const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16)
      return istInterneAdresse(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`)
    }
    return false
  }
  return true
}

/** Prüft Schema und Ziel-IP einer Adresse. Wirft, wenn etwas nicht stimmt. */
async function pruefeAdresse(roh: string): Promise<URL> {
  let u: URL
  try {
    u = new URL(roh)
  } catch {
    throw new Error('Keine gültige Adresse')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Nur http und https')
  }
  // Steht schon eine IP im Namen, gilt sie direkt; sonst auflösen.
  const name = u.hostname.replace(/^\[|\]$/g, '')
  const ips = isIP(name)
    ? [name]
    : (await lookup(name, { all: true })).map((e) => e.address)
  if (ips.length === 0) throw new Error('Adresse nicht auflösbar')
  for (const ip of ips) {
    if (istInterneAdresse(ip)) throw new Error('Adresse zeigt ins interne Netz')
  }
  return u
}

export async function holeBild(req: Request, res: Response): Promise<void> {
  const roh = (req.body ?? {}).url as string | undefined
  if (!roh || typeof roh !== 'string') {
    res.status(400).json({ error: 'url fehlt' })
    return
  }

  const abbruch = new AbortController()
  const uhr = setTimeout(() => abbruch.abort(), ZEITLIMIT_MS)
  try {
    let ziel = await pruefeAdresse(roh)
    let antwort: globalThis.Response | null = null

    // Umleitungen von Hand verfolgen, damit JEDE Station geprüft wird. Mit
    // `redirect: 'follow'` käme der Server sonst über einen Umweg doch noch
    // an eine interne Adresse.
    for (let i = 0; i <= MAX_UMLEITUNGEN; i++) {
      antwort = await fetch(ziel, {
        redirect: 'manual',
        signal: abbruch.signal,
        headers: { 'User-Agent': 'Heron-AI-Studio/1.0' },
      })
      if (antwort.status >= 300 && antwort.status < 400) {
        const weiter = antwort.headers.get('location')
        if (!weiter) break
        ziel = await pruefeAdresse(new URL(weiter, ziel).toString())
        continue
      }
      break
    }

    if (!antwort || !antwort.ok) {
      res.status(502).json({ error: `Bild nicht erreichbar (${antwort?.status ?? 'keine Antwort'})` })
      return
    }

    const typ = antwort.headers.get('content-type')?.split(';')[0].trim() ?? ''
    if (!typ.startsWith('image/')) {
      res.status(415).json({ error: `Das ist kein Bild (${typ || 'ohne Typangabe'})` })
      return
    }
    const angekuendigt = Number(antwort.headers.get('content-length') ?? 0)
    if (angekuendigt > MAX_BYTES) {
      res.status(413).json({ error: 'Bild ist zu gross' })
      return
    }

    // Die angekündigte Grösse ist nur eine Behauptung — hier zählt, was
    // tatsächlich ankommt.
    const daten = Buffer.from(await antwort.arrayBuffer())
    if (daten.length > MAX_BYTES) {
      res.status(413).json({ error: 'Bild ist zu gross' })
      return
    }

    res.json({
      mimeType: typ,
      data: daten.toString('base64'),
      name: decodeURIComponent(ziel.pathname.split('/').pop() || 'bild') || 'bild',
    })
  } catch (e) {
    const meldung = e instanceof Error ? e.message : 'Fehler'
    console.warn('[bild-holen]', meldung)
    res.status(400).json({ error: meldung })
  } finally {
    clearTimeout(uhr)
  }
}

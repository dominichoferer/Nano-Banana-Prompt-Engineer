// Schatten und Spiegelung für freigestellte Produkte — von der App gerechnet,
// nicht vom Bildmodell gemalt.
//
// Der Anlass: Bat man ein Bildmodell um „transparent mit Schatten", kam der
// Schatten als fleckiger, verrauschter Grauschleier zurück, oft über die ganze
// Fläche verteilt wie Rauch. Das liegt nicht am Prompt. Ein weicher Schatten
// ist eine Fläche mit HALBER Deckkraft, und genau die bilden die Modelle im
// Alphakanal nicht sauber ab — sie würfeln sie als Rauschen aus. Mit einem
// besseren Prompt wird das seltener, aber nie verlässlich gut.
//
// Deshalb die Arbeitsteilung: Das Modell liefert nur das freigestellte
// Produkt, ohne Schatten (harte Kanten kann es gut). Schatten und Spiegelung
// entstehen hier aus der Silhouette des Produkts — glatt, ohne Rauschen und
// regelbar. Die Pixel des Produkts selbst werden dabei nicht angefasst.
//
// Die Rechnung läuft auf rohen RGBA-Daten statt über Canvas-Filter. So ist sie
// in jedem Browser gleich (Safari kannte `ctx.filter` lange nicht) und lässt
// sich ohne Browser prüfen.

export type SchattenArt = 'keiner' | 'kontakt' | 'boden' | 'spiegelung' | 'kontakt_spiegelung'

export const SCHATTEN_ARTEN: Array<{ id: SchattenArt; label: string; hint: string }> = [
  { id: 'kontakt', label: 'Kontaktschatten', hint: 'Dunkle Auflagelinie mit weichem Auslauf — der klassische Produktshot' },
  { id: 'boden', label: 'Bodenschatten', hint: 'Weicher, runder Schatten wie unter Licht von oben' },
  { id: 'spiegelung', label: 'Spiegelung', hint: 'Spiegelbild auf glänzendem Boden, nach unten ausblendend' },
  { id: 'kontakt_spiegelung', label: 'Schatten + Spiegelung', hint: 'Auflagelinie und Spiegelbild zusammen' },
  { id: 'keiner', label: 'Nur säubern', hint: 'Kein Schatten — nur Grauschleier und Flecken um das Produkt entfernen' },
]

export interface SchattenOptionen {
  art: SchattenArt
  /** Deckkraft des Schattens bzw. der Spiegelung, 0–1. */
  staerke: number
  /** Wie weich der Schatten ausläuft, 0–1. */
  weichheit: number
  /** Länge der Spiegelung als Anteil der Produkthöhe, 0–1. */
  laenge: number
  /**
   * Halbtransparenten Schleier und lose Flecken um das Produkt entfernen —
   * genau das, was ein Modell als „Schatten" in den Alphakanal rauscht.
   */
  schleierEntfernen: boolean
}

export const SCHATTEN_STANDARD: SchattenOptionen = {
  art: 'kontakt',
  staerke: 0.55,
  weichheit: 0.5,
  laenge: 0.35,
  schleierEntfernen: true,
}

/** Rohbild, RGBA, nicht vormultipliziert — so wie `ImageData` es liefert. */
export interface Pixelbild {
  breite: number
  hoehe: number
  daten: Uint8ClampedArray
}

// ── Schleier entfernen ──────────────────────────────────────────────────────

/** Ab dieser Deckkraft gilt ein Pixel als Produkt. */
const KERN_ALPHA = 200

/**
 * Entfernt, was nicht zum Produkt gehört: halbtransparenten Dunst und lose
 * Inseln. Übrig bleibt der deckende Kern, plus ein schmaler Saum darum, damit
 * die geglättete Kante erhalten bleibt.
 *
 * Inseln fliegen nur raus, wenn sie klein sind gegenüber dem grössten Teil —
 * ein Produkt aus mehreren getrennten Teilen bleibt ganz.
 */
export function entferneSchleier(bild: Pixelbild): Pixelbild {
  const { breite: w, hoehe: h, daten } = bild
  const n = w * h
  const kern = new Uint8Array(n)
  for (let i = 0; i < n; i++) kern[i] = daten[i * 4 + 3] >= KERN_ALPHA ? 1 : 0

  // Zusammenhängende Flächen des Kerns zählen (4er-Nachbarschaft).
  const marke = new Int32Array(n).fill(-1)
  const flaechen: number[] = []
  const stapel = new Int32Array(n)
  for (let start = 0; start < n; start++) {
    if (!kern[start] || marke[start] !== -1) continue
    const id = flaechen.length
    let oben = 0, anzahl = 0
    stapel[oben++] = start
    marke[start] = id
    while (oben > 0) {
      const p = stapel[--oben]
      anzahl++
      const x = p % w
      if (x > 0 && kern[p - 1] && marke[p - 1] === -1) { marke[p - 1] = id; stapel[oben++] = p - 1 }
      if (x < w - 1 && kern[p + 1] && marke[p + 1] === -1) { marke[p + 1] = id; stapel[oben++] = p + 1 }
      if (p >= w && kern[p - w] && marke[p - w] === -1) { marke[p - w] = id; stapel[oben++] = p - w }
      if (p < n - w && kern[p + w] && marke[p + w] === -1) { marke[p + w] = id; stapel[oben++] = p + w }
    }
    flaechen.push(anzahl)
  }
  const groesste = flaechen.reduce((m, a) => Math.max(m, a), 0)
  const mindest = Math.max(40, groesste * 0.015)
  for (let i = 0; i < n; i++) {
    if (kern[i] && flaechen[marke[i]] < mindest) kern[i] = 0
  }

  // Saum: der Kern um 2 px geweitet. Was ausserhalb liegt, ist Schleier.
  const saum = weite(kern, w, h, 2)
  const aus = new Uint8ClampedArray(daten)
  for (let i = 0; i < n; i++) {
    if (!saum[i]) aus[i * 4 + 3] = 0
  }
  return { breite: w, hoehe: h, daten: aus }
}

/** Binäre Maske um r Pixel weiten (quadratisch, getrennt nach Achsen). */
function weite(maske: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const zeile = new Uint8Array(maske.length)
  for (let y = 0; y < h; y++) {
    let letzte = -Infinity
    for (let x = 0; x < w; x++) {
      if (maske[y * w + x]) letzte = x
      if (x - letzte <= r) zeile[y * w + x] = 1
    }
    letzte = Infinity
    for (let x = w - 1; x >= 0; x--) {
      if (maske[y * w + x]) letzte = x
      if (letzte - x <= r) zeile[y * w + x] = 1
    }
  }
  const aus = new Uint8Array(maske.length)
  for (let x = 0; x < w; x++) {
    let letzte = -Infinity
    for (let y = 0; y < h; y++) {
      if (zeile[y * w + x]) letzte = y
      if (y - letzte <= r) aus[y * w + x] = 1
    }
    letzte = Infinity
    for (let y = h - 1; y >= 0; y--) {
      if (zeile[y * w + x]) letzte = y
      if (letzte - y <= r) aus[y * w + x] = 1
    }
  }
  return aus
}

// ── Weichzeichnen ───────────────────────────────────────────────────────────

/**
 * Dreifacher Kastenfilter, getrennt nach Achsen — kommt einer Gaussglocke sehr
 * nahe und kostet unabhängig vom Radius dasselbe.
 */
export function weichzeichnen(feld: Float32Array, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.round(radius / 1.7))
  if (r < 1) return
  const puffer = new Float32Array(Math.max(w, h))
  for (let durchgang = 0; durchgang < 3; durchgang++) {
    for (let y = 0; y < h; y++) kasten(feld, y * w, 1, w, r, puffer)
    for (let x = 0; x < w; x++) kasten(feld, x, w, h, r, puffer)
  }
}

function kasten(f: Float32Array, start: number, schritt: number, laenge: number, r: number, p: Float32Array): void {
  const breite = 2 * r + 1
  let summe = 0
  for (let i = -r; i <= r; i++) {
    const k = Math.min(laenge - 1, Math.max(0, i))
    summe += f[start + k * schritt]
  }
  for (let i = 0; i < laenge; i++) {
    p[i] = summe / breite
    const raus = Math.max(0, i - r)
    const rein = Math.min(laenge - 1, i + r + 1)
    summe += f[start + rein * schritt] - f[start + raus * schritt]
  }
  for (let i = 0; i < laenge; i++) f[start + i * schritt] = p[i]
}

// ── Geometrie des Produkts ──────────────────────────────────────────────────

interface Rahmen { links: number; rechts: number; oben: number; unten: number }

function rahmen(bild: Pixelbild, schwelle = 8): Rahmen | null {
  const { breite: w, hoehe: h, daten } = bild
  let links = w, rechts = -1, oben = h, unten = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (daten[(y * w + x) * 4 + 3] > schwelle) {
        if (x < links) links = x
        if (x > rechts) rechts = x
        if (y < oben) oben = y
        if (y > unten) unten = y
      }
    }
  }
  return rechts < 0 ? null : { links, rechts, oben, unten }
}

/**
 * Die Unterkante je Spalte: die tiefste Zeile, in der das Produkt deckt.
 * Geglättet, damit eine Bohrung oder ein Vorsprung an der Kante keine Zacken
 * in Schatten und Spiegelung reisst. -1 = in dieser Spalte kein Produkt.
 */
function unterkante(bild: Pixelbild, r: Rahmen): { roh: Int32Array; glatt: Int32Array } {
  const { breite: w, daten } = bild
  const roh = new Int32Array(w).fill(-1)
  for (let x = r.links; x <= r.rechts; x++) {
    for (let y = r.unten; y >= r.oben; y--) {
      if (daten[(y * w + x) * 4 + 3] >= 128) { roh[x] = y; break }
    }
  }
  const fenster = Math.max(1, Math.round((r.rechts - r.links) * 0.012))
  const aus = new Int32Array(w).fill(-1)
  for (let x = r.links; x <= r.rechts; x++) {
    if (roh[x] < 0) continue
    // Das Maximum im Fenster: Die Kante wird eher nach unten geglättet als
    // nach oben, sonst entstünde zwischen Produkt und Schatten eine Lücke.
    let m = roh[x]
    for (let k = -fenster; k <= fenster; k++) {
      const v = roh[x + k]
      if (v !== undefined && v > m) m = v
    }
    aus[x] = m
  }
  return { roh, glatt: aus }
}

// ── Platz schaffen ──────────────────────────────────────────────────────────

/** Wie viel Platz unter dem Produkt gebraucht wird, als Anteil seiner Höhe. */
function platzBedarf(opt: SchattenOptionen): number {
  const schatten = opt.art === 'kontakt' || opt.art === 'kontakt_spiegelung'
    ? 0.05 + 0.1 * opt.weichheit : 0
  const boden = opt.art === 'boden' ? 0.08 + 0.12 * opt.weichheit : 0
  const spiegel = opt.art === 'spiegelung' || opt.art === 'kontakt_spiegelung' ? opt.laenge : 0
  return Math.max(schatten, boden, spiegel)
}

/**
 * Rückt das Produkt so zurecht, dass Schatten oder Spiegelung ins Bild passen.
 * Bleibt das Format gleich — ein 1:1-Bild bleibt 1:1 —, und nur wenn es nicht
 * anders geht, wird das Produkt verkleinert. Passt alles, bleibt jedes Pixel
 * an seinem Platz.
 */
function einpassen(bild: Pixelbild, r: Rahmen, bedarf: number): Pixelbild {
  const { breite: w, hoehe: h } = bild
  const rand = Math.round(h * 0.03)
  const objH = r.unten - r.oben + 1
  const blockOben = r.oben
  const blockUnten = r.unten + Math.ceil(objH * bedarf)
  if (blockUnten <= h - rand) return bild

  const blockH = blockUnten - blockOben + 1
  const platz = h - 2 * rand
  const skala = Math.min(1, platz / blockH)
  // Verschieben reicht, wenn oben genug Luft ist; sonst verkleinern und
  // senkrecht mittig setzen.
  const neuOben = skala < 1 ? rand : Math.max(rand, blockOben - (blockUnten - (h - rand)))
  const mitteX = (r.links + r.rechts) / 2

  const aus = new Uint8ClampedArray(w * h * 4)
  const q = bild.daten
  for (let y = 0; y < h; y++) {
    const sy = blockOben + (y - neuOben) / skala
    if (sy < 0 || sy > h - 1) continue
    for (let x = 0; x < w; x++) {
      const sx = mitteX + (x - mitteX) / skala
      if (sx < 0 || sx > w - 1) continue
      bilinear(q, w, h, sx, sy, aus, (y * w + x) * 4)
    }
  }
  return { breite: w, hoehe: h, daten: aus }
}

/** Bilineares Abtasten mit vormultipliziertem Alpha, damit Kanten nicht dunkel säumen. */
function bilinear(q: Uint8ClampedArray, w: number, h: number, x: number, y: number, ziel: Uint8ClampedArray, o: number): void {
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  let r = 0, g = 0, b = 0, a = 0
  const nehmen = (px: number, py: number, gew: number) => {
    const i = (py * w + px) * 4
    const al = q[i + 3] * gew
    r += q[i] * al; g += q[i + 1] * al; b += q[i + 2] * al; a += al
  }
  nehmen(x0, y0, (1 - fx) * (1 - fy))
  nehmen(x1, y0, fx * (1 - fy))
  nehmen(x0, y1, (1 - fx) * fy)
  nehmen(x1, y1, fx * fy)
  if (a > 0) {
    ziel[o] = r / a; ziel[o + 1] = g / a; ziel[o + 2] = b / a; ziel[o + 3] = a
  }
}

// ── Schatten und Spiegelung ─────────────────────────────────────────────────

/**
 * Das Produkt mit Schatten und/oder Spiegelung, weiterhin freigestellt.
 *
 * Die Ebenen, von unten nach oben: Schatten (schwarz, halbtransparent),
 * Spiegelung, Produkt. Das Produkt liegt obenauf und bleibt unverändert —
 * ausser es musste verkleinert werden, damit der Schatten ins Format passt.
 */
export function rendereSchatten(eingang: Pixelbild, opt: SchattenOptionen): Pixelbild {
  let bild = opt.schleierEntfernen ? entferneSchleier(eingang) : eingang
  let r = rahmen(bild)
  if (!r || opt.art === 'keiner') return bild

  bild = einpassen(bild, r, platzBedarf(opt))
  r = rahmen(bild)
  if (!r) return bild

  const { breite: w, hoehe: h, daten } = bild
  const n = w * h
  const objB = r.rechts - r.links + 1
  const objH = r.unten - r.oben + 1
  // Die Grösse der Schatten richtet sich nach dem Produkt, nicht nach dem Bild —
  // so sieht die Vorschau in kleiner Auflösung genauso aus wie der Export.
  const mass = Math.max(objB, objH)
  // `roh` ist die echte Kante, `glatt` die geglättete. Der Schatten beginnt an
  // der echten (sonst klafft an einer schrägen Kante ein heller Spalt) und
  // läuft von der geglätteten aus (sonst zeichnet er jede Zacke nach).
  const { roh: kanteRoh, glatt: kante } = unterkante(bild, r)

  const schatten = new Float32Array(n)

  if (opt.art === 'kontakt' || opt.art === 'kontakt_spiegelung') {
    // Zwei Anteile: eine enge, dunkle Auflagelinie und ein breiter, heller
    // Auslauf. Nur einer davon sieht entweder nach Strich oder nach Nebel aus.
    const d1 = (0.004 + 0.008 * opt.weichheit) * objH
    const d2 = (0.02 + 0.07 * opt.weichheit) * objH
    const nah = new Float32Array(n)
    const fern = new Float32Array(n)
    for (let x = r.links; x <= r.rechts; x++) {
      const b = kante[x]
      if (b < 0) continue
      const anfang = Math.min(kanteRoh[x], b)
      const bis1 = Math.min(h - 1, Math.ceil(b + d1 * 6))
      for (let y = Math.max(0, Math.floor(anfang - d1)); y <= bis1; y++) {
        nah[y * w + x] = Math.exp(-Math.max(0, y - b) / d1)
      }
      const bis2 = Math.min(h - 1, Math.ceil(b + d2 * 5))
      for (let y = Math.max(0, Math.floor(anfang - d2 * 0.5)); y <= bis2; y++) {
        fern[y * w + x] = Math.exp(-Math.max(0, y - b) / d2)
      }
    }
    weichzeichnen(nah, w, h, Math.max(1.5, d1 * 1.2))
    weichzeichnen(fern, w, h, d2 * 1.4 + mass * 0.01)
    const faktor = opt.art === 'kontakt_spiegelung' ? 0.8 : 1
    for (let i = 0; i < n; i++) {
      schatten[i] = Math.min(1, opt.staerke * faktor * (0.9 * nah[i] + 0.5 * fern[i]))
    }
  }

  if (opt.art === 'boden') {
    // Ellipse unter dem Produkt, zur Mitte am dunkelsten.
    const cx = (r.links + r.rechts) / 2
    const tief = kante.reduce((m, v) => Math.max(m, v), r.unten)
    const rx = objB * (0.5 + 0.08 * opt.weichheit)
    const ry = objH * (0.04 + 0.08 * opt.weichheit)
    const cy = tief - ry * 0.25
    const oben = Math.max(0, Math.floor(cy - ry * 2))
    const unten = Math.min(h - 1, Math.ceil(cy + ry * 2))
    for (let y = oben; y <= unten; y++) {
      for (let x = Math.max(0, Math.floor(cx - rx * 1.5)); x <= Math.min(w - 1, Math.ceil(cx + rx * 1.5)); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry
        const d = dx * dx + dy * dy
        if (d < 1) schatten[y * w + x] = (1 - d) * (1 - d)
      }
    }
    weichzeichnen(schatten, w, h, ry * (0.6 + opt.weichheit))
    for (let i = 0; i < n; i++) schatten[i] = Math.min(1, schatten[i] * opt.staerke * 0.8)
  }

  // Vormultiplizierte Arbeitsebene: erst der Schatten (schwarz), dann die
  // Spiegelung darüber, zuletzt das Produkt.
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n)
  const A = Float32Array.from(schatten)

  if (opt.art === 'spiegelung' || opt.art === 'kontakt_spiegelung') {
    // Je Spalte an der eigenen Unterkante gespiegelt statt an einer
    // gemeinsamen Linie. Bei einem schräg fotografierten Teil liegt die
    // Unterkante links höher als rechts; an einer gemeinsamen Linie
    // gespiegelt, klaffte dort eine Lücke zwischen Teil und Spiegelbild.
    const L = Math.max(1, opt.laenge * objH)
    const sr = new Float32Array(n), sg = new Float32Array(n), sb = new Float32Array(n), sa = new Float32Array(n)
    for (let x = r.links; x <= r.rechts; x++) {
      // Hier die echte Kante: Das Spiegelbild muss am Teil ansetzen.
      const b = kanteRoh[x]
      if (b < 0) continue
      for (let d = 1; d <= L; d++) {
        const zy = b + d, qy = b - d
        if (zy >= h || qy < 0) break
        const qi = (qy * w + x) * 4
        const al = (daten[qi + 3] / 255) * Math.pow(1 - d / L, 1.6)
        const zi = zy * w + x
        sr[zi] = daten[qi] * al; sg[zi] = daten[qi + 1] * al; sb[zi] = daten[qi + 2] * al; sa[zi] = al
      }
    }
    const unschaerfe = 0.5 + opt.weichheit * mass * 0.006
    for (const f of [sr, sg, sb, sa]) weichzeichnen(f, w, h, unschaerfe)
    const deck = Math.min(1, opt.staerke * 0.7)
    for (let i = 0; i < n; i++) {
      const a = sa[i] * deck
      if (a <= 0) continue
      R[i] = sr[i] * deck + R[i] * (1 - a)
      G[i] = sg[i] * deck + G[i] * (1 - a)
      B[i] = sb[i] * deck + B[i] * (1 - a)
      A[i] = a + A[i] * (1 - a)
    }
  }

  const aus = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const pa = daten[i * 4 + 3] / 255
    const a = pa + A[i] * (1 - pa)
    if (a <= 0) continue
    const r_ = daten[i * 4] * pa + R[i] * (1 - pa)
    const g_ = daten[i * 4 + 1] * pa + G[i] * (1 - pa)
    const b_ = daten[i * 4 + 2] * pa + B[i] * (1 - pa)
    aus[i * 4] = r_ / a
    aus[i * 4 + 1] = g_ / a
    aus[i * 4 + 2] = b_ / a
    aus[i * 4 + 3] = a * 255
  }
  return { breite: w, hoehe: h, daten: aus }
}

// ── Brücke zum Browser ──────────────────────────────────────────────────────

/** Bild aus einer Adresse laden, auf höchstens `maxKante` verkleinert. */
export function ladePixel(url: string, maxKante = Infinity): Promise<Pixelbild> {
  return new Promise((fertig, fehler) => {
    const img = new Image()
    img.onload = () => {
      const skala = Math.min(1, maxKante / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * skala))
      c.height = Math.max(1, Math.round(img.height * skala))
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, c.width, c.height)
      const d = ctx.getImageData(0, 0, c.width, c.height)
      fertig({ breite: c.width, hoehe: c.height, daten: d.data })
    }
    img.onerror = () => fehler(new Error('Bild konnte nicht geladen werden'))
    img.src = url
  })
}

export function alsPngUrl(bild: Pixelbild): string {
  const c = document.createElement('canvas')
  c.width = bild.breite; c.height = bild.hoehe
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bild.daten), bild.breite, bild.hoehe), 0, 0)
  return c.toDataURL('image/png')
}

/**
 * Hat das Bild überhaupt einen Hintergrund, der durchsichtig ist? Nur dann
 * ergibt das Schatten-Werkzeug Sinn. Geprüft wird ein Rand von Pixeln —
 * ein freigestelltes Produkt steht praktisch nie bis an alle vier Kanten.
 */
export function istFreigestellt(bild: Pixelbild): boolean {
  const { breite: w, hoehe: h, daten } = bild
  let durchsichtig = 0, gezaehlt = 0
  const schritt = Math.max(1, Math.floor((w + h) / 400))
  for (let x = 0; x < w; x += schritt) {
    for (const y of [0, h - 1]) {
      gezaehlt++
      if (daten[(y * w + x) * 4 + 3] < 250) durchsichtig++
    }
  }
  for (let y = 0; y < h; y += schritt) {
    for (const x of [0, w - 1]) {
      gezaehlt++
      if (daten[(y * w + x) * 4 + 3] < 250) durchsichtig++
    }
  }
  return gezaehlt > 0 && durchsichtig / gezaehlt > 0.5
}

/**
 * Welche Schattenart der Auftragstext meint — damit das Werkzeug gleich mit
 * der richtigen Einstellung aufgeht.
 */
export function schattenAusAuftrag(text?: string): SchattenArt | null {
  const t = text?.toLowerCase() ?? ''
  const spiegel = /spiegel|reflex|reflektion|reflection|reflect|glossy floor|glänzend\w* boden/.test(t)
  const schatten = /schatten|shadow|schlagschatten|kontaktschatten/.test(t)
  if (spiegel && schatten) return 'kontakt_spiegelung'
  if (spiegel) return 'spiegelung'
  if (/bodenschatten|drop ?shadow|weicher schatten/.test(t)) return 'boden'
  if (schatten) return 'kontakt'
  return null
}

/** Verlangt der Auftragstext ein freigestelltes Ergebnis? */
export function willFreigestellt(text?: string): boolean {
  return /transparen|freigestellt|freistell|ohne hintergrund|kein(en)? hintergrund|alpha|cut ?out|no background/i
    .test(text ?? '')
}

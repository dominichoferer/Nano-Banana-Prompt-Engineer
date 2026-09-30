import { useEffect, useRef, useState } from 'react'
import type { SchattenArt, SchattenOptionen, Pixelbild } from '../schatten'
import {
  SCHATTEN_ARTEN, SCHATTEN_STANDARD, ladePixel, rendereSchatten, alsPngUrl, istFreigestellt,
} from '../schatten'

interface Props {
  /** Das freigestellte Ergebnis (Daten-URL). */
  bild: string
  /** Womit das Werkzeug aufgeht — aus dem Auftragstext abgeleitet. */
  startArt: SchattenArt | null
  /** Das fertige Bild mit Schatten als Ergebnis übernehmen. */
  onUebernehmen: (url: string, art: SchattenArt) => void
}

/** Kante der Vorschau. Die Rechnung ist massstabsunabhängig, der Export sieht gleich aus. */
const VORSCHAU_KANTE = 900

// Schachbrett, damit man sieht, was durchsichtig ist — und wie weich der
// Schatten darauf wirklich ausläuft.
const SCHACH = {
  backgroundColor: '#fff',
  backgroundImage: 'linear-gradient(45deg,#e8e6e1 25%,transparent 25%),linear-gradient(-45deg,#e8e6e1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e8e6e1 75%),linear-gradient(-45deg,transparent 75%,#e8e6e1 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0,0 10px,10px -10px,-10px 0',
}

/**
 * Schatten und Spiegelung auf ein freigestelltes Ergebnis legen. Taucht nur
 * auf, wenn das Bild wirklich einen durchsichtigen Hintergrund hat.
 */
export default function SchattenStudio({ bild, startArt, onUebernehmen }: Props) {
  const [freigestellt, setFreigestellt] = useState<boolean | null>(null)
  const [opt, setOpt] = useState<SchattenOptionen>({ ...SCHATTEN_STANDARD, art: startArt ?? 'kontakt' })
  const [vorschau, setVorschau] = useState<string | null>(null)
  const [hintergrund, setHintergrund] = useState<'schach' | 'weiss' | 'grau'>('weiss')
  const [exportLaeuft, setExportLaeuft] = useState(false)
  const klein = useRef<Pixelbild | null>(null)

  // Ein neues Bild: neu laden und prüfen, ob es überhaupt freigestellt ist.
  useEffect(() => {
    let aktiv = true
    klein.current = null
    setVorschau(null)
    ladePixel(bild, VORSCHAU_KANTE)
      .then((p) => {
        if (!aktiv) return
        klein.current = p
        setFreigestellt(istFreigestellt(p))
      })
      .catch(() => aktiv && setFreigestellt(false))
    return () => { aktiv = false }
  }, [bild])

  useEffect(() => { if (startArt) setOpt((o) => ({ ...o, art: startArt })) }, [startArt])

  // Vorschau neu rechnen, leicht verzögert, damit ein gezogener Regler nicht
  // bei jedem Pixel eine Rechnung auslöst.
  useEffect(() => {
    if (!freigestellt || !klein.current) return
    const t = setTimeout(() => {
      if (klein.current) setVorschau(alsPngUrl(rendereSchatten(klein.current, opt)))
    }, 60)
    return () => clearTimeout(t)
  }, [opt, freigestellt])

  if (!freigestellt) return null

  /** In voller Auflösung rechnen — erst beim Übernehmen oder Herunterladen. */
  const vollbild = async (): Promise<string> => {
    setExportLaeuft(true)
    try {
      const voll = await ladePixel(bild)
      await new Promise((r) => setTimeout(r, 0))
      return alsPngUrl(rendereSchatten(voll, opt))
    } finally {
      setExportLaeuft(false)
    }
  }

  const herunterladen = async () => {
    const url = await vollbild()
    const a = document.createElement('a')
    a.href = url
    a.download = `heron-freigestellt-${opt.art}-${Date.now()}.png`
    a.click()
  }

  const regler = (label: string, feld: 'staerke' | 'weichheit' | 'laenge') => (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-[11px] font-sans text-ink-500">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(opt[feld] * 100)} %</span>
      </span>
      <input type="range" min={0} max={1} step={0.01} value={opt[feld]}
        onChange={(e) => setOpt((o) => ({ ...o, [feld]: Number(e.target.value) }))}
        className="accent-heron-500" />
    </label>
  )

  const mitSpiegel = opt.art === 'spiegelung' || opt.art === 'kontakt_spiegelung'

  return (
    <div className="flex flex-col gap-3 border-t-2 border-cream-200 pt-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="label-section">Schatten &amp; Spiegelung</span>
        <span className="text-[10px] font-sans text-ink-400">
          Von der App gerechnet — glatt statt fleckig, das Produkt bleibt pixelgleich.
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SCHATTEN_ARTEN.map((a) => (
          <button key={a.id} type="button" title={a.hint}
            onClick={() => setOpt((o) => ({ ...o, art: a.id }))}
            className={`px-3 py-1.5 rounded-lg text-xs font-sans font-medium transition-all
              ${opt.art === a.id ? 'bg-heron-500 text-white shadow-sm' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'}`}>
            {a.label}
          </button>
        ))}
      </div>

      <div className="relative rounded-xl overflow-hidden border border-cream-200"
        style={hintergrund === 'schach' ? SCHACH : { backgroundColor: hintergrund === 'weiss' ? '#fff' : '#9a9893' }}>
        {vorschau
          ? <img src={vorschau} alt="Vorschau mit Schatten" className="w-full h-auto block" />
          : <div className="aspect-video flex items-center justify-center text-xs text-ink-400">wird berechnet…</div>}
        <div className="absolute top-2 right-2 flex gap-1 bg-white/90 rounded-lg p-1 shadow-card">
          {(['weiss', 'grau', 'schach'] as const).map((h) => (
            <button key={h} type="button" onClick={() => setHintergrund(h)}
              title={h === 'schach' ? 'Transparenz zeigen' : `Auf ${h === 'weiss' ? 'Weiss' : 'Grau'} ansehen`}
              className={`text-[10px] font-sans px-2 py-1 rounded ${hintergrund === h ? 'bg-heron-500 text-white' : 'text-ink-500'}`}>
              {h === 'weiss' ? 'Weiss' : h === 'grau' ? 'Grau' : 'Transparent'}
            </button>
          ))}
        </div>
      </div>

      {opt.art !== 'keiner' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {regler('Stärke', 'staerke')}
          {regler('Weichheit', 'weichheit')}
          {mitSpiegel && regler('Länge der Spiegelung', 'laenge')}
        </div>
      )}

      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={opt.schleierEntfernen}
          onChange={(e) => setOpt((o) => ({ ...o, schleierEntfernen: e.target.checked }))}
          className="mt-0.5 accent-heron-500" />
        <span className="text-[11px] font-sans text-ink-500 leading-snug">
          Grauschleier und Flecken ums Produkt entfernen — das, was das Modell als „Schatten“ in
          den Hintergrund rauscht.
        </span>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={exportLaeuft}
          onClick={async () => onUebernehmen(await vollbild(), opt.art)}
          className="btn-secondary py-2.5 text-sm">
          {exportLaeuft ? 'Wird gerechnet…' : 'Als Ergebnis übernehmen'}
        </button>
        <button type="button" disabled={exportLaeuft} onClick={herunterladen}
          className="btn-primary py-2.5 text-sm">
          PNG herunterladen
        </button>
      </div>
    </div>
  )
}

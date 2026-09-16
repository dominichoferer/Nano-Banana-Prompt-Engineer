// Anthropic-Schlüssel prüfen und in die lokale .env eintragen.
//
//   npm run key:anthropic          → prüft den Schlüssel, der gerade drin steht
//   npm run key:anthropic -- neu   → fragt nach einem neuen und tauscht ihn aus
//
// Der Schlüssel wird bei der Eingabe nicht angezeigt, landet nicht in der
// Shell-Historie und wird nirgends ausgegeben — nur seine Länge und sein
// Präfix, damit man sieht, dass der richtige angekommen ist.
//
// Vor dem Schreiben wird der Schlüssel gegen die echte API geprüft. Ein
// ungültiger Schlüssel kommt gar nicht erst in die Datei: Genau daran ist es
// zuletzt gescheitert — der Eintrag sah gut aus und wurde trotzdem mit 401
// abgelehnt, und der Fehler fiel erst beim Generieren auf.

import { readFileSync, writeFileSync, copyFileSync, realpathSync } from 'fs'
import { createInterface } from 'readline'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const HIER = dirname(fileURLToPath(import.meta.url))
const ENV_PFAD = realpathSync(resolve(HIER, '..', '.env'))
const NAME = 'ANTHROPIC_API_KEY'

function zeigbar(schluessel) {
  return `${schluessel.slice(0, 11)}…${schluessel.slice(-4)} (${schluessel.length} Zeichen)`
}

async function pruefe(schluessel) {
  const r = await fetch('https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': schluessel, 'anthropic-version': '2023-06-01' },
  })
  if (r.ok) return { gut: true }
  const j = await r.json().catch(() => ({}))
  return { gut: false, grund: `HTTP ${r.status} — ${j?.error?.message ?? 'unbekannt'}` }
}

/** Eingabe ohne Anzeige, damit der Schlüssel nicht im Terminal stehen bleibt. */
function frage(text) {
  return new Promise((fertig) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const schreib = rl.output.write.bind(rl.output)
    let stumm = false
    rl.output.write = (s) => { if (!stumm) schreib(s) }
    rl.question(text, (antwort) => {
      rl.output.write = schreib
      schreib('\n')
      rl.close()
      fertig(antwort.trim())
    })
    stumm = true
  })
}

function lies() {
  const zeilen = readFileSync(ENV_PFAD, 'utf8').split('\n')
  const i = zeilen.findIndex((z) => z.startsWith(`${NAME}=`))
  if (i === -1) return { zeilen, i, wert: null }
  return { zeilen, i, wert: zeilen[i].slice(NAME.length + 1).replace(/^["']|["']$/g, '').trim() }
}

const { zeilen, i, wert } = lies()
console.log(`Datei: ${ENV_PFAD}`)

if (wert) {
  process.stdout.write(`Vorhandener Schlüssel ${zeigbar(wert)} … `)
  const { gut, grund } = await pruefe(wert)
  console.log(gut ? '✓ gültig' : `✗ ungültig (${grund})`)
  if (gut && process.argv[2] !== 'neu') {
    console.log('\nNichts zu tun. Zum Austauschen: npm run key:anthropic -- neu')
    process.exit(0)
  }
} else {
  console.log(`Kein ${NAME} in der Datei.`)
}

// Ohne Terminal gibt es keine verdeckte Eingabe — dann lieber sauber abbrechen,
// als auf eine Eingabe zu warten, die nie kommt.
if (!process.stdin.isTTY) {
  console.log('\nZum Eintragen eines neuen Schlüssels im Terminal ausführen:')
  console.log('  npm run key:anthropic -- neu')
  process.exit(1)
}

console.log('\nNeuen Schlüssel eintragen.')
console.log('Findest du unter https://console.anthropic.com/settings/keys')
console.log('— oder in Vercel unter Settings → Environment Variables, falls der dort gültig ist.')
const neu = await frage('\nSchlüssel (Eingabe wird nicht angezeigt): ')

if (!neu) {
  console.log('Nichts eingegeben — abgebrochen, Datei unverändert.')
  process.exit(1)
}
if (!neu.startsWith('sk-ant-')) {
  console.log('Das sieht nicht nach einem Anthropic-Schlüssel aus (erwartet „sk-ant-…").')
  process.exit(1)
}

process.stdout.write(`Prüfe ${zeigbar(neu)} … `)
const { gut, grund } = await pruefe(neu)
if (!gut) {
  console.log(`✗ abgelehnt (${grund})`)
  console.log('Die Datei bleibt unverändert.')
  process.exit(1)
}
console.log('✓ gültig')

// Sicherungskopie, bevor etwas überschrieben wird.
const sicherung = `${ENV_PFAD}.bak-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`
copyFileSync(ENV_PFAD, sicherung)

const neueZeile = `${NAME}=${neu}`
if (i === -1) zeilen.push(neueZeile)
else zeilen[i] = neueZeile
writeFileSync(ENV_PFAD, zeilen.join('\n'), { mode: 0o600 })

console.log(`\nEingetragen. Der alte Eintrag ist weg, Sicherung liegt unter:\n  ${sicherung}`)
console.log('\nFür die Produktion zusätzlich:')
console.log('  vercel env rm ANTHROPIC_API_KEY production -y')
console.log('  vercel env add ANTHROPIC_API_KEY production')
console.log('  vercel --prod   (damit das Deployment den neuen Wert bekommt)')

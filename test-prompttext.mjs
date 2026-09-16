// Prüft den Auftragstext an den Prompt-Schreiber, ohne die API aufzurufen.
// Hier entscheidet sich, ob Rollen, Bildnummern und Bildbezüge sauber
// ankommen — der Rest ist nur noch Formulierung.
//   npx tsx test-prompttext.mjs
import { buildUserMessage } from './server/analyze.ts'

const BILDER = [
  { name: 'portrait-klein.png', rolle: 'ausgang', rollenRegel: 'SOURCE MATERIAL — reproduce faithfully', faceLock: true, objectLock: false, customLock: '' },
  { name: 'studio-licht.png', rolle: 'ziel', rollenRegel: 'TARGET REFERENCE — look only', faceLock: false, objectLock: false, customLock: '' },
  { name: 'jacke.png', rolle: 'ausgang', rollenRegel: 'SOURCE MATERIAL — reproduce faithfully', faceLock: false, objectLock: true, customLock: 'Logo am Ärmel' },
]
const text = buildUserMessage(BILDER, 'Das Gesicht von Bild 1 behalten. Licht wie in Bild 2.', 'retouch', ['lighting'])

let fehler = 0
const pruefe = (name, bedingung) => {
  if (!bedingung) fehler++
  console.log(`${bedingung ? '  OK ' : 'FEHL'} | ${name}`)
}

console.log('— Bildindex —')
pruefe('IMAGE 1 mit Dateiname und Rolle', /IMAGE 1 — "portrait-klein\.png".*SOURCE MATERIAL/s.test(text))
pruefe('IMAGE 2 als Zielreferenz', /IMAGE 2 — "studio-licht\.png".*TARGET REFERENCE/s.test(text))
pruefe('IMAGE 3 vorhanden', text.includes('IMAGE 3 — "jacke.png"'))

console.log('\n— Rollenblock —')
pruefe('Ausgangsmaterial nennt IMAGE 1 und 3', /SOURCE MATERIAL: IMAGE 1, IMAGE 3/.test(text))
pruefe('Zielreferenz nennt IMAGE 2', /TARGET REFERENCE: IMAGE 2\./.test(text))
pruefe('Identität entscheidet die Rolle, nicht die Bildqualität',
  /Identity is decided by ROLE, never by image quality/.test(text))
pruefe('Kompressionsartefakte dürfen nicht als Hautflecken erscheinen',
  /compression artefacts show up as blotchy skin/.test(text))

console.log('\n— Auflösung der Bildbezüge —')
pruefe('„Bild 1" wird IMAGE 1 zugeordnet', text.includes('"Bild 1" / "Image 1"') && text.includes('= IMAGE 1'))
pruefe('„die Vorlage" wird dem Ausgangsmaterial zugeordnet', /"die Vorlage".*SOURCE MATERIAL/s.test(text))
pruefe('„das Gesicht" ohne Nummer meint das Ausgangsmaterial', /"das Gesicht" without a number = the face in the SOURCE MATERIAL/.test(text))
pruefe('Mehrdeutiges muss benannt werden', text.includes('Never silently pick one'))

console.log('\n— Locks —')
pruefe('Gesicht-Lock für IMAGE 1', /FACE LOCK \(IMAGE 1\)/.test(text))
pruefe('Objekt-Lock für IMAGE 3', /SUBJECT LOCK \(IMAGE 3\)/.test(text))
pruefe('Eigener Lock im Wortlaut', text.includes('Logo am Ärmel'))

console.log('\n— Ausgabeform —')
pruefe('JSON verlangt, ohne Zaun', text.includes('Output the JSON object and nothing else'))
pruefe('reference_images zuerst', text.includes('Write "reference_images" first'))
pruefe('preserve wird erzwungen (Ausgangsmaterial vorhanden)', /"preserve" — one entry per lock|"preserve" — everything the source material/.test(text))
pruefe('angeforderter Bereich „lighting" gelistet', text.includes('"lighting"'))
pruefe('nicht angeforderte Bereiche nicht verlangt', !text.includes('Fill these keys:\n— "color"'))

console.log(`\n${fehler === 0 ? 'Alle Prüfungen bestanden.' : fehler + ' Abweichungen.'}`)
process.exit(fehler === 0 ? 0 : 1)

// Prüft die Rollen-Mechanik (B3) und die Identitätsklausel (B4/B5).
//   npx tsx test-rollen.mjs
import { baueLegende, bildManifest, setzeManifest, begrenze } from './src/referenzen.ts'
import { identitaetsKlausel } from './src/identitaet.ts'

const ORDNUNG = ['ausgang', 'ziel', 'person']
const roh = [
  { mimeType: 'image/jpeg', data: 'x', rolle: 'ziel',    zeigt: 'studio-licht.jpg' },
  { mimeType: 'image/jpeg', data: 'x', rolle: 'ausgang', zeigt: 'portrait-thumb.jpg' },
  { mimeType: 'image/jpeg', data: 'x', rolle: 'ausgang', zeigt: 'jacke.jpg' },
]
// Dieselbe Sortierung wie in der App
const liste = [...roh].sort((a, b) => ORDNUNG.indexOf(a.rolle) - ORDNUNG.indexOf(b.rolle))

let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
  if (!bedingung) fehler++
  console.log(`${bedingung ? '  OK ' : 'FEHL'} | ${name}${zusatz ? '  → ' + zusatz : ''}`)
}

const legende = baueLegende(liste)
const manifest = bildManifest(liste)
const klausel = identitaetsKlausel([1, 2], [3])

console.log('— Reihenfolge und Nummerierung —')
pruefe('Ausgangsmaterial steht vorn', liste[0].rolle === 'ausgang' && liste[1].rolle === 'ausgang')
pruefe('Legende nennt IMAGES 1–2 als Ausgangsmaterial', legende.includes('IMAGES 1–2 = SOURCE MATERIAL'))
pruefe('Legende nennt IMAGE 3 als Zielreferenz', legende.includes('IMAGE 3 = TARGET REFERENCE'))
pruefe('Manifest nummeriert identisch zur Legende',
  manifest.every((e, i) => e.id === `IMAGE ${i + 1}` && e.role === liste[i].rolle))
pruefe('Manifest zeigt dieselben Dateien in derselben Folge',
  manifest.map((e) => e.shows).join('|') === liste.map((b) => b.zeigt).join('|'))

console.log('\n— B4: Identität —')
pruefe('Klausel überstimmt ausdrücklich alles davor', klausel.includes('OVERRIDES EVERYTHING ABOVE'))
pruefe('Klausel nennt die Ausgangsbilder namentlich', klausel.includes('IMAGE 1 and IMAGE 2'))
pruefe('Klausel erklärt die Zielreferenz zum Platzhalter',
  klausel.includes('IMAGE 3 shows a DIFFERENT person'))
pruefe('Ohne Ausgangsmaterial keine Klausel', identitaetsKlausel([], [3]) === '')

console.log('\n— B5: Identität ist nicht Dateiqualität —')
pruefe('Klausel trennt WER von WIE SAUBER', klausel.includes('IDENTITY IS NOT FILE QUALITY'))
pruefe('Klausel benennt beide Fehlschläge (wächsern UND fleckig)',
  /waxy/.test(klausel) && /blotchy/.test(klausel))
pruefe('Rollentext des Ausgangsmaterials trennt sie ebenfalls',
  legende.includes('IDENTITY IS NOT THE SAME AS FILE QUALITY'))

console.log('\n— Zusammenbau wie in der App —')
const volltext = [legende, '{"scene":"portrait"}', klausel].filter(Boolean).join('\n\n')
pruefe('Legende steht ganz vorn', volltext.startsWith('IMAGE ROLES'))
pruefe('Identität steht ganz hinten',
  volltext.lastIndexOf('IDENTITY — THIS SECTION OVERRIDES') > volltext.lastIndexOf('IMAGE ROLES'))

console.log('\n— Manifest in JSON-Prompts —')
const mitJson = setzeManifest('```json\n{"scene":"x","images":[{"id":"IMAGE 1","shows":"ein sehr ausführlich beschriebenes Porträt"}]}\n```', liste)
const j = JSON.parse(mitJson)
pruefe('widersprüchliche Altlisten werden entfernt', !('images' in j) && !('source_images' in j))
pruefe('reference_images kommt aus der echten Reihenfolge', j.reference_images.length === 3)
pruefe('bessere Beschreibung des Prompt-Schreibers bleibt erhalten',
  j.reference_images[0].shows.includes('ausführlich beschriebenes Porträt'))
pruefe('Fließtext-Prompt bleibt unverändert Fließtext',
  setzeManifest('EIN TEXTPROMPT OHNE JSON', liste) === 'EIN TEXTPROMPT OHNE JSON')

console.log('\n— Kappen zu langer Listen —')
const viele = [...Array(20)].map((_, i) => ({ ...roh[0], rolle: i < 3 ? 'ausgang' : 'ziel', zeigt: `b${i}` }))
const gekappt = begrenze(viele, 5)
pruefe('kappt auf die Höchstzahl', gekappt.length === 5)
pruefe('Ausgangsmaterial überlebt das Kappen',
  gekappt.filter((b) => b.rolle === 'ausgang').length === 3)

console.log(`\n${fehler === 0 ? 'Alle Prüfungen bestanden.' : fehler + ' Abweichungen.'}`)
process.exit(fehler === 0 ? 0 : 1)

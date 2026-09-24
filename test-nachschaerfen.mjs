// Prüft die Mechanik des Nachschärfens ohne API-Aufruf.
//   npx tsx test-nachschaerfen.mjs
import { korrekturBlock, mitKorrektur, befund } from './src/nachschaerfen.ts'

let fehler = 0
const pruefe = (name, b) => { if (!b) fehler++; console.log(`${b ? '  OK ' : 'FEHL'} | ${name}`) }

const abw = [
  { was: 'Text auf der Titelseite', erwartet: '„HERON Innovationsfactory"', gesehen: '„HERON Innovation Factury"', schwere: 'schwer' },
  { was: 'Hintergrundfarbe', erwartet: 'neutrales Grau', gesehen: 'leicht bläulich', schwere: 'leicht' },
]
const block = korrekturBlock(2, 'Die Jacke muss die aus Bild 2 sein.', abw, true)

console.log('— Korrekturblock —')
pruefe('nennt den Durchgang', block.includes('CORRECTION PASS 2'))
pruefe('überstimmt alles davor', block.includes('OVERRIDES EVERYTHING ABOVE'))
pruefe('ändert NUR das Benannte', /Change ONLY what is\s+listed/.test(block))
pruefe('Worte des Nutzers sind bindend', block.includes('binding') && block.includes('Die Jacke muss die aus Bild 2 sein.'))
pruefe('Schweres steht unter MUST BE FIXED', /MUST BE FIXED:[\s\S]*Titelseite/.test(block))
pruefe('Leichtes steht getrennt darunter', /ALSO OFF[\s\S]*Hintergrundfarbe/.test(block))
pruefe('erklärt das mitgeschickte Gegenbeispiel', block.includes('REJECTED ATTEMPT'))
pruefe('verbietet, daraus Gesicht/Objekt zu nehmen', /never take a face, an object or wording from\s+it/.test(block))

console.log('\n— ohne Gegenbeispiel —')
const ohne = korrekturBlock(2, 'x', [], false)
pruefe('kein Hinweis auf ein Vorbild', !ohne.includes('REJECTED ATTEMPT'))

console.log('\n— Anhängen an den Prompt —')
const original = 'IMAGE ROLES — …\n\n{"task":"mockup"}\n\nIDENTITY — …'
const einmal = mitKorrektur(original, block)
pruefe('ursprünglicher Prompt bleibt vollständig', einmal.startsWith(original))
pruefe('Korrektur steht ganz am Ende', einmal.trimEnd().endsWith(block.trimEnd()))

const block3 = korrekturBlock(3, 'Und jetzt noch der Rand.', [], false)
const zweimal = mitKorrektur(einmal, block3)
pruefe('zweite Runde ERSETZT die erste Korrektur', !zweimal.includes('CORRECTION PASS 2'))
pruefe('dritte Korrektur ist da', zweimal.includes('CORRECTION PASS 3'))
pruefe('Prompt ist immer noch vollständig', zweimal.startsWith(original))
pruefe('nur EIN Korrekturblock im Text', (zweimal.match(/CORRECTION PASS/g) ?? []).length === 1)

console.log('\n— Kurzbefund —')
pruefe('gut', befund({ bewertung: 'gut', zusammenfassung: '', abweichungen: [] }) === 'Passt zum Auftrag.')
pruefe('zählt schwer und leicht', befund({ bewertung: 'falsch', zusammenfassung: '', abweichungen: abw }) === 'Abweichungen: 1× schwer, 1× leicht')

console.log(`\n${fehler === 0 ? 'Alle Prüfungen bestanden.' : fehler + ' Abweichungen.'}`)
process.exit(fehler === 0 ? 0 : 1)

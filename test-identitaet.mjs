// Gegenproben für die Gesicht-Lock-Erkennung (Teil C der Portierung).
//
// Eine zu WEITE Erkennung ist schlimmer als eine zu enge: Ein Gesicht-Lock auf
// einem Produktfoto macht den Prompt schlechter, nicht besser. Deshalb stehen
// hier beide Richtungen — Sätze, die auslösen müssen, und Sätze, die es nicht
// dürfen.
//
//   node --experimental-strip-types test-identitaet.mjs
//   oder: npx tsx test-identitaet.mjs

import { willGesichtLock } from './src/identitaet.ts'

const MUSS = [
  'Gesicht-Lock setzen',
  '100 % Gesicht von Ausgangsmaterial',
  'aus gesicht von referenz ein portrait wie bei ziel',
  'Das Gesicht soll exakt vom Ausgangsbild kommen',
  'Gesicht aus der Vorlage behalten',
  'Die Person muss die gleiche bleiben, nur der Hintergrund ändert sich',
  'Identität beibehalten, Rest darf sich ändern',
  'keep the face from the source image',
  'same person, different background',
  'face lock on image 1',
]

const DARF_NICHT = [
  'Produktfoto vom Turnschuh, weißer Hintergrund',
  'Ein Flyer im Querformat mit viel Weißraum',
  'Das Gesicht der Statue soll verwittert wirken',
  'Mach den Hintergrund heller und die Farben wärmer',
  'Mockup einer Kaffeetasse auf einem Holztisch',
  'a modern office building at golden hour',
  'Die Schrift soll gut lesbar im Vordergrund stehen',
]

let fehler = 0
console.log('— muss auslösen —')
for (const t of MUSS) {
  const ok = willGesichtLock(t)
  if (!ok) fehler++
  console.log(`${ok ? '  OK ' : 'FEHL'} | ${t}`)
}
console.log('\n— darf NICHT auslösen —')
for (const t of DARF_NICHT) {
  const ok = !willGesichtLock(t)
  if (!ok) fehler++
  console.log(`${ok ? '  OK ' : 'FEHL'} | ${t}`)
}
const gesamt = MUSS.length + DARF_NICHT.length
console.log(`\n${gesamt - fehler}/${gesamt} wie erwartet, ${fehler} Abweichungen.`)
process.exit(fehler === 0 ? 0 : 1)

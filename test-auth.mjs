// Die Zehn-Fälle-Tabelle für die Anmeldung.
//
// Sie hat den Fehler gefunden, mit dem alles anfing: Ein Tippfehler in
// AUTH_USERS ergab eine leere Benutzerliste, damit galt die Anmeldung als
// abgeschaltet, und requireAuth liess JEDE Anfrage durch. Gegen den damaligen
// Stand fielen 7 von 9 Fällen durch.
//
// Technik: server/auth.ts wird mehrfach mit wechselnden Umgebungsvariablen
// importiert; „?v=n" umgeht den Modul-Cache.
//
//   npx tsx test-auth.mjs
import { pathToFileURL } from 'url'
import { resolve } from 'path'

const PFAD = pathToFileURL(resolve('server/auth.ts')).href

const GUELTIG = JSON.stringify([{ email: 'a@b.de', hash: 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA' }])
const OHNE_HASH = JSON.stringify([{ email: 'a@b.de', hash: 'plaintext123' }])

const FAELLE = [
  { name: 'alles richtig, kein Cookie',       env: { AUTH_USERS: GUELTIG,   AUTH_SECRET: 's' }, erwartet: 401 },
  { name: 'AUTH_USERS kaputtes JSON',         env: { AUTH_USERS: '{kaputt', AUTH_SECRET: 's' }, erwartet: 503 },
  { name: 'AUTH_SECRET fehlt',                env: { AUTH_USERS: GUELTIG                     }, erwartet: 503 },
  { name: 'AUTH_USERS leerer String',         env: { AUTH_USERS: '',        AUTH_SECRET: 's' }, erwartet: 503 },
  { name: 'AUTH_USERS leeres Array',          env: { AUTH_USERS: '[]',      AUTH_SECRET: 's' }, erwartet: 503 },
  { name: 'gar nichts gesetzt, VERCEL=1',     env: { VERCEL: '1' },                             erwartet: 503 },
  { name: 'Eintrag ohne scrypt$-Hash',        env: { AUTH_USERS: OHNE_HASH, AUTH_SECRET: 's' }, erwartet: 503 },
  { name: 'richtig gesetzt, kaputtes Cookie', env: { AUTH_USERS: GUELTIG,   AUTH_SECRET: 's' },
    cookie: 'heron_session=%E0%A4%A', erwartet: 401 },
  { name: 'gar nichts gesetzt, lokal',        env: {},                                          erwartet: 'durch' },
]

let n = 0, fehler = 0
for (const f of FAELLE) {
  for (const k of ['AUTH_USERS', 'AUTH_SECRET', 'VERCEL', 'NODE_ENV']) delete process.env[k]
  Object.assign(process.env, f.env)
  const mod = await import(`${PFAD}?v=${++n}`)
  let ergebnis = 'kein Ergebnis'
  const req = { headers: f.cookie ? { cookie: f.cookie } : {} }
  const res = { status(c) { ergebnis = c; return this }, json() { return this } }
  try {
    mod.requireAuth(req, res, () => { ergebnis = 'durch' })
  } catch (e) {
    ergebnis = `500 (${e instanceof Error ? e.message.slice(0, 30) : 'Fehler'})`
  }
  const ok = ergebnis === f.erwartet
  if (!ok) fehler++
  console.log(`${ok ? '  OK ' : 'FEHL'} | ${f.name.padEnd(34)} | erwartet ${String(f.erwartet).padEnd(6)} | ist ${ergebnis}`)
}
console.log(`\n${FAELLE.length - fehler}/${FAELLE.length} wie erwartet, ${fehler} Abweichungen.`)
process.exit(fehler === 0 ? 0 : 1)

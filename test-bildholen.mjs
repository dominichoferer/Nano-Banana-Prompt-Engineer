// Prüft die Absicherung von /api/bild-holen (SSRF).
// Ein Endpunkt, der beliebige Adressen abruft, darf nicht als Sprungbrett ins
// interne Netz taugen — Cloud-Metadaten, localhost, Nachbardienste.
//   npx tsx test-bildholen.mjs
import { holeBild } from './server/bildholen.ts'
import { createServer } from 'http'

function ruf(url) {
  return new Promise((fertig) => {
    let status = 200, body = null
    holeBild({ body: { url } }, {
      status(c) { status = c; return this },
      json(b) { body = b; fertig({ status, body }); return this },
    })
  })
}

// Ein echter lokaler Server, um Umleitungen ins interne Netz zu prüfen
const hilfsserver = createServer((req, res) => {
  if (req.url === '/um') { res.writeHead(302, { Location: 'http://127.0.0.1:1/geheim' }); res.end(); return }
  if (req.url === '/text') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>kein Bild</h1>'); return }
  res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from('89504e47', 'hex'))
})
await new Promise((f) => hilfsserver.listen(0, '127.0.0.1', f))
const port = hilfsserver.address().port

const FAELLE = [
  ['localhost',                 'http://localhost:8080/bild.png',        'blockiert'],
  ['Loopback-IP',               'http://127.0.0.1/bild.png',             'blockiert'],
  ['Cloud-Metadaten',           'http://169.254.169.254/latest/meta-data', 'blockiert'],
  ['privates Netz 10.x',        'http://10.0.0.5/bild.png',              'blockiert'],
  ['privates Netz 192.168.x',   'http://192.168.1.1/bild.png',           'blockiert'],
  ['privates Netz 172.16.x',    'http://172.16.0.9/bild.png',            'blockiert'],
  ['IPv6-Loopback',             'http://[::1]/bild.png',                 'blockiert'],
  ['IPv4-in-IPv6',              'http://[::ffff:127.0.0.1]/bild.png',    'blockiert'],
  ['file-Schema',               'file:///etc/passwd',                    'blockiert'],
  ['gopher-Schema',             'gopher://127.0.0.1:70/',                'blockiert'],
  ['keine Adresse',             'null',                                  'blockiert'],
  ['Umleitung ins interne Netz', `http://127.0.0.1:${port}/um`,          'blockiert'],
  // Der Hilfsserver liegt auf 127.0.0.1 und wird schon von der Adressprüfung
  // gestoppt — die Typprüfung käme dort nie zum Zug. Deshalb dafür eine echte
  // öffentliche Adresse, die kein Bild liefert.
  ['Antwort ist kein Bild',     'https://example.com/',                  'blockiert'],
]

let fehler = 0
for (const [name, url, erwartet] of FAELLE) {
  const { status, body } = await ruf(url)
  const blockiert = status >= 400
  const ok = (erwartet === 'blockiert') === blockiert
  if (!ok) fehler++
  console.log(`${ok ? '  OK ' : 'FEHL'} | ${name.padEnd(28)} | HTTP ${status} ${String(body?.error ?? '').slice(0, 44)}`)
}
hilfsserver.close()
console.log(`\n${FAELLE.length - fehler}/${FAELLE.length} blockiert wie erwartet.`)
process.exit(fehler === 0 ? 0 : 1)

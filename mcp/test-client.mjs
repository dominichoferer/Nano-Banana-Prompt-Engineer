// Prüft den gebündelten MCP-Server so, wie Claude ihn benutzt: über stdio.
// Aufruf: node mcp/test-client.mjs <bild> <ausgabeordner>   (kostet echte API-Aufrufe)
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const hier = path.dirname(fileURLToPath(import.meta.url))
const [, , bildPfad, ausgabe] = process.argv
const t = new StdioClientTransport({ command: process.execPath, args: [path.join(hier, 'dist/heron-studio.mjs')], stderr: 'inherit' })
const c = new Client({ name: 'test', version: '1' })
await c.connect(t)
const { tools } = await c.listTools()
console.log('Werkzeuge:', tools.map((x) => x.name).join(', '))
const zeig = (r) => r.content.map((x) => x.type === 'text' ? x.text.slice(0, 600) : `[Bild ${x.mimeType}, ${Math.round(x.data.length * 0.75 / 1024)} KB]`).join('\n')

const bilder = [{ pfad: bildPfad, rolle: 'ausgang' }]
const auftrag = 'Produkt freistellen, transparent mit Kontaktschatten, Produkt exakt gleich lassen'
let t0 = Date.now()
const p = await c.callTool({ name: 'prompt_schreiben', arguments: { auftrag, bilder, produktfoto: true } })
console.log(`\n— prompt_schreiben (${Date.now() - t0} ms)`, p.isError ? 'FEHLER' : '', '\n' + zeig(p).slice(0, 400))
const prompt = p.content[0].text

t0 = Date.now()
const g = await c.callTool({ name: 'bild_generieren', arguments: {
  prompt, bilder, modelle: ['flare'], aufloesung: '1K', seitenverhaeltnis: '16:9',
  freigestellt: true, produktfoto: true, schatten: 'kontakt', ausgabe_ordner: ausgabe, dateiname: 'mcp-test' } })
console.log(`\n— bild_generieren (${Date.now() - t0} ms)`, g.isError ? 'FEHLER' : '', '\n' + zeig(g))
const erg = /✓ [^:]+: (.+\.png)/.exec(g.content[0].text)?.[1]

if (erg) {
  t0 = Date.now()
  const pr = await c.callTool({ name: 'bild_pruefen', arguments: { bild: erg, bilder, auftrag, freigestellt: true } })
  console.log(`\n— bild_pruefen (${Date.now() - t0} ms)`, pr.isError ? 'FEHLER' : '', '\n' + zeig(pr))
  t0 = Date.now()
  const s = await c.callTool({ name: 'schatten_setzen', arguments: { bild: erg, art: 'spiegelung' } })
  console.log(`\n— schatten_setzen (${Date.now() - t0} ms)`, s.isError ? 'FEHLER' : '', '\n' + zeig(s))
}
await c.close()

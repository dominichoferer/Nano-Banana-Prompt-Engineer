# HERON AI Studio als MCP-Server

Dieselben Werkzeuge wie die Web-App, direkt in Claude Code und Claude Desktop.
Läuft lokal, ohne Anmeldung, mit den Schlüsseln aus der `.env` des Projekts.

| Werkzeug | Was es tut |
|---|---|
| `prompt_schreiben` | Referenzbilder + Auftrag → JSON-Prompt (Rollen, Produktfoto, Mockup) |
| `bild_generieren` | Nano Banana 2.1/Pro, GPT Image 2.5 Flare/Sunburst; freigestellt, Schatten, Nachschärfen (`korrektur`) |
| `bild_pruefen` | Ergebnis gegen Auftrag und Referenzen halten, Abweichungen auflisten |
| `prompt_optimieren` | Prompt nach einem misslungenen Ergebnis gezielt überarbeiten |
| `schatten_setzen` | Glatter Kontakt-/Bodenschatten oder Spiegelung unter ein freigestelltes PNG |

Bilder landen unter `~/Pictures/HERON AI Studio/<Datum>/`, der gesendete Prompt als `.txt` daneben.

## Bauen

```
npm run mcp:build      # → mcp/dist/heron-studio.mjs (eine Datei, braucht node_modules danach nicht mehr)
```

Nach jeder Änderung an `server/`, `src/` oder `mcp/` neu bauen und Claude neu starten.

## Eintragen

Claude Code (für alle Projekte):

```
claude mcp add --scope user heron-studio -- /usr/local/bin/node "<Projektpfad>/mcp/dist/heron-studio.mjs"
```

Claude Desktop: in `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
"mcpServers": {
  "heron-studio": { "command": "/usr/local/bin/node", "args": ["<Projektpfad>/mcp/dist/heron-studio.mjs"] }
}
```

Wird das Projekt verschoben, die Pfade anpassen — oder `HERON_STUDIO_DIR` setzen, damit die `.env` gefunden wird.

## Testen

```
node mcp/test-client.mjs <bild.jpg> <ausgabeordner>   # ganze Kette, kostet echte API-Aufrufe
```

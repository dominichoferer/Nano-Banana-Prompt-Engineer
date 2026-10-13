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

## Installieren und aktualisieren

```
npm run mcp:install    # baut und kopiert nach ~/.claude/mcp/heron-studio/heron-studio.mjs
```

Die installierte Datei ist eigenständig: Sie braucht weder `node_modules` noch den Projektordner.
Die Schlüssel liest sie aus der Datei in `HERON_STUDIO_ENV`
(`~/.secrets/_HERON/Prompt & Image Generator /.env`). Nach einer Änderung an `server/`, `src/` oder
`mcp/` einfach erneut `npm run mcp:install` und Claude neu starten.

## Eintragen (einmalig, schon erledigt)

Claude Code — gilt auch für die Claude-Erweiterung in VS Code:

```
claude mcp add --scope user heron-studio \
  -e "HERON_STUDIO_ENV=$HOME/.secrets/_HERON/Prompt & Image Generator /.env" \
  -- /usr/local/bin/node ~/.claude/mcp/heron-studio/heron-studio.mjs
```

Claude Desktop — `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
"mcpServers": {
  "heron-studio": {
    "command": "/usr/local/bin/node",
    "args": ["/Users/hod/.claude/mcp/heron-studio/heron-studio.mjs"],
    "env": { "HERON_STUDIO_ENV": "/Users/hod/.secrets/_HERON/Prompt & Image Generator /.env" }
  }
}
```

## Testen

```
node mcp/test-client.mjs <bild.jpg> <ausgabeordner>   # ganze Kette, kostet echte API-Aufrufe
```

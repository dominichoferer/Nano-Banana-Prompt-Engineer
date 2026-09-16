# Übergabe: Was aus dem Schwesterprojekt hier eingebaut werden soll

Dieses Dokument ist die Übergabe aus einer längeren Arbeitssitzung an einem **zweiten,
verwandten Bildgenerierungs-Werkzeug**. Beide Projekte stammen aus demselben Ursprung
(gleiche Dateistruktur: `server/analyze.ts`, `server/generate.ts`, `api/index.ts`,
`src/App.tsx`); das andere ist seither deutlich weitergewachsen.

**Quellprojekt:** `/Users/hod/Documents/VS Code/sca-ai-studio`
Die hier beschriebenen Änderungen liegen dort in den Commits `c5065a7` (Modelle,
Identität) und `11f8d0d` (Sicherheit).

---

## Regel 0 — keine Vermischung der Kunden

Das Quellprojekt gehört **einem bestimmten Kunden**. Aus ihm wird ausschließlich
**Mechanik und Code** übernommen, niemals Inhalt.

**Darf NICHT herüber:**

- `src/bibliothek.ts` — Personen, Wappen, Orte des Kunden
- `src/posting.ts` — Layoutmaße der Instagram-Grafiken des Kunden
- `src/jerseyPrompt.ts`, `src/webshop.ts` — kundenspezifische Produktmechanik
- Schriften (kommerzielle Lizenzen), Vereinsfarben, Logos, Fotos
- `public/bibliothek/`, `public/kulisse/`, `public/filter/*.xmp`
- Jeder Prompttext, in dem der Kundenname steht

**Wichtig beim Portieren:** In den Prompttexten des Quellprojekts steht der Kundenname
an mehreren Stellen fest verdrahtet (z. B. in `ROLLEN_REGEL.verein`). Beim Übernehmen
müssen diese Rollen entweder **ganz entfallen** oder **neutral** formuliert werden.
Im Zweifel weglassen.

---

## Teil A — Drei Fehler, die in DIESEM Projekt stecken

Diese drei stammen nicht aus einem Wunschzettel, sondern wurden im Schwesterprojekt
gefunden, reproduziert und behoben. Der Code hier ist an denselben Stellen unverändert,
also gelten sie hier genauso.

### A1 — Die Anmeldung fällt auf, nicht zu (ernst)

`server/auth.ts`, Zeile 46:

```
console.error('AUTH_USERS env var is not valid JSON — auth disabled')
cachedUsers = []
```

und Zeile 129:

```
if (!isAuthEnabled()) return next()
```

**Folge:** Ein Tippfehler in `AUTH_USERS` ergibt kaputtes JSON → leere Benutzerliste →
die Anmeldung gilt als *abgeschaltet* → `requireAuth` lässt **jede** Anfrage durch. Die
Seite steht offen im Netz und jeder fremde Aufruf geht auf das API-Kontingent — ohne
eine einzige Fehlermeldung. Dasselbe bei fehlendem `AUTH_SECRET`, leerem String und
leerem Array.

**Lösung** (im Quellprojekt in `server/auth.ts` fertig zu übernehmen): drei Zustände
statt zwei.

| Lage | Wann | Folge |
|---|---|---|
| `aktiv` | Benutzer und Geheimnis stehen | wird geprüft, ohne Cookie **401** |
| `aus` | beides fehlt vollständig | lokal offen (Entwicklung), **im Betrieb 503** |
| `kaputt` | gesetzt, aber unbrauchbar | **immer 503**, überall |

Als `kaputt` gilt: kaputtes JSON, kein Array, leere Liste, Einträge ohne `scrypt$`-Hash,
Benutzer ohne `AUTH_SECRET`. „Im Betrieb" heißt `process.env.VERCEL === '1'` oder
`NODE_ENV === 'production'`.

Dazu gehört im Frontend ein eigener Bildschirm: Bei Lage `kaputt` liefert `/api/auth/me`
einen 503, und die App zeigt eine Erklärung statt eines Anmeldeformulars, das nie
funktionieren kann.

### A2 — Absturz durch ein Cookie, von außen auslösbar

`server/auth.ts`, in `parseCookies`:

```
out[k] = decodeURIComponent(v.join('='))
```

`decodeURIComponent` wirft bei ungültigen Prozentzeichen. Ein
`Cookie: sca_session=%E0%A4%A` von irgendwem erzeugt einen **500er auf jeder
geschützten Route**. Lösung: `try/catch` um die Dekodierung, im Fehlerfall den Rohwert
nehmen. Ein unlesbares Cookie ist einfach keines.

### A3 — Die Modellweiche verschluckt Unbekanntes

`server/generate.ts`, Zeile 225:

```
const modelKey: GenModel = body.model === 'openai' ? 'openai' : 'pro'
```

Alles, was nicht wörtlich `'openai'` heißt, landet still bei Gemini. Sobald ein weiteres
Modell dazukommt (siehe B1), wählt der Nutzer OpenAI und bekommt eine Rechnung von
Google — ohne Fehlermeldung. Lösung: eine geprüfte Liste mit ausdrücklichem Rückfall auf
die Voreinstellung.

---

## Teil B — Was übernommen werden soll

Nach Nutzen sortiert. B0 zuerst, das ist Sicherheit.

### B0 — Die drei Fehler aus Teil A beheben

Quelle: `server/auth.ts` und `server/generate.ts` im Quellprojekt, Commit `11f8d0d`.

Dazu gehört die **Bremse gegen das Durchprobieren von Passwörtern**, die es hier noch
gar nicht gibt: zwei Zähler über 15 Minuten, **8 Fehlversuche je Herkunft (IP)** und
**40 je Konto**. Die Kontogrenze ist bewusst weit — eine enge wäre selbst eine Waffe,
mit der ein Fremder den rechtmäßigen Nutzer aussperrt. Eine erfolgreiche Anmeldung
löscht beide Zähler.

> Grenze der Lösung, die auch so dokumentiert gehört: Der Zähler liegt im
> Arbeitsspeicher der Function-Instanz. Vercel startet mehrere, jede kalte beginnt bei
> null. Das ist eine Bremse, keine Mauer.

Ebenfalls dort: Der API-Schlüsselvergleich brach bei ungleicher Länge sofort ab und
verriet damit die Schlüssellänge. Läuft jetzt über SHA-256 ohne frühen Abbruch.

### B1 — Neue Bildmodelle: GPT Image 2.5

Dieses Projekt kennt nur `gemini-3-pro-image-preview` und `gpt-image-2`. Aktuell sind:

| Modell-ID | Anbieter | Rolle |
|---|---|---|
| `gpt-image-2.5-flare` | OpenAI | **Voreinstellung** — bessere Bilder als gpt-image-2 bei etwa halber Wartezeit |
| `gpt-image-2.5-sunburst` | OpenAI | Qualitätsstufe, genaueste Kontrolle bei Bearbeitungen |
| `gpt-image-2` | OpenAI | die vorige Fassung, für Reproduzierbarkeit |
| `gemini-3-pro-image` | Google | ohne `-preview` |
| `gemini-3.1-flash-image` | Google | günstig und schnell |

**Preise.** Google nennt feste Beträge je Bild: Pro `$0.134` (1K/2K) und `$0.24` (4K),
Flash `$0.067 / $0.101 / $0.151`. OpenAI rechnet nach Token ab, **$30 je 1 Mio.
Ausgabe-Token, für alle drei Modelle gleich**. Gemessen ist dort nur gpt-image-2 in 4K
(~$0.71); die kleineren Stufen sind hochgerechnet.

> **Achtung, häufiges Missverständnis:** Die Ankündigung von 2.5 Flare verspricht
> **50 % weniger Latenz, nicht 50 % weniger Kosten.** OpenAI schreibt zwar „token rates
> match GPT Image 2", zugleich aber, dass der gpt-image-2-Rechner den Verbrauch von 2.5
> nicht abbildet. Alle Beträge für Flare/Sunburst sind also Richtwerte — als solche
> kennzeichnen, nicht als Tatsachen hinschreiben.

**Neue Fähigkeit:** Nur gpt-image-2.5 kann **freigestellt** ausgeben
(`background: "transparent"`). Das erzwingt PNG oder WebP — JPEG hat keinen Alphakanal.
Im Quellprojekt erscheint der Schalter erst, wenn **jedes** gewählte Modell es kann,
sonst käme ein Teil einer Serie mit Hintergrund zurück.

Quality-Werte sind bei 2.5 erweitert: `low, medium, high, xhigh, max, auto`. Das
Quellprojekt nutzt weiterhin nur `low/medium/high` (über die Auflösungsstufe), um das
Kostenverhalten nicht still zu verändern.

### B2 — Modellauswahl als zwei Familien mit Dropdown

Fünf Modelle passen nicht mehr als Kacheln nebeneinander. Im Quellprojekt:
**zwei Schalter** (eine Anbieterfamilie je Schalter), in jedem ein `<select>` mit den
Modellen dieser Familie. Beide Schalter gleichzeitig aktivierbar — dann rechnet jedes
Modell denselben Auftrag.

Wichtig an der Umsetzung: **Familie und gewähltes Modell sind getrennter State.** Beim
Abwählen einer Familie geht die Modellwahl darin sonst verloren.

Beim Überfahren eines Schalters erscheint eine Karte mit Stärken und ungefährem Preis;
unter jedem Dropdown steht zusätzlich der Preis für die **gerade gewählte Auflösung** —
das funktioniert auch auf dem Telefon, wo es kein Hover gibt.

Quelle: `src/types.ts` (`GEN_MODELS`, `GEN_FAMILIEN`, `istGpt`, `kannTransparenz`) und
der Modellblock in `src/App.tsx`.

### B3 — Rollen für Referenzbilder: Ausgangsmaterial vs. Zielreferenz

Das ist die wertvollste Mechanik und vollständig kundenneutral.

Zwei getrennte Upload-Bereiche statt einem:

- **Ausgangsmaterial** — woraus etwas entstehen soll. Wird originalgetreu übernommen.
- **Zielreferenz** — wie das Ergebnis aussehen soll: Farbe, Licht, Perspektive,
  Ausschnitt, Umgebung. **Nicht** die Objekte oder Personen daraus.

Quelle: `src/referenzen.ts`. Der Kern ist `ROLLEN_REGEL` — je Rolle ein Absatz, der dem
Bildmodell sagt, wie es mit diesen Bildern umzugehen hat — plus `baueLegende()`, das
daraus eine nummerierte Legende vor den Prompt setzt, und `setzeManifest()`, das
dieselbe Information maschinenlesbar ins JSON schreibt.

**Warum das Modul überhaupt existiert:** Vorher sah der Prompt-Schreiber nur die
hochgeladenen Bilder, weitere Referenzen kamen erst bei der Generierung dazu. Damit
stimmte die Nummerierung nicht mehr — was das JSON „IMAGE 2" nannte, war beim Bildmodell
ein anderes Bild. Die Reihenfolge wird jetzt **einmal** festgelegt und von beiden Seiten
benutzt. Diesen Fehler sollte man hier gar nicht erst einbauen.

Beim Portieren die Rollen `verein`, `kulisse`, `stil`, `gegner` **weglassen** — die sind
kundenspezifisch. `ausgang`, `ziel` und `person` reichen.

### B4 — Identität: wessen Gesicht im Ergebnis steht

Quelle: `src/identitaet.ts` (vollständig kundenneutral, kann 1:1 herüber).

**Der Fehler, den das löst:** Im Ausgangsmaterial lag ein Porträt (12 KB, Thumbnail), in
der Zielreferenz ein anderes (658 KB, scharf). Im Auftrag stand „100 % Gesicht von
Ausgangsmaterial". Heraus kam die Person aus der **Zielreferenz**. Drei Ursachen:

1. Die Rollentexte beschrieben **Gegenstände** („shape, material, every print, seam and
   logo"). Für ein Gesicht stand dort nichts.
2. Der Key `preserve` — das einzige pixelgenaue Mittel im Prompt-Schema — stand nur bei
   ausdrücklich gesetztem Lock in der Ausgabeliste. Wer den Wunsch nur in den
   Auftragstext schrieb, bekam ihn nie.
3. Das Schema kannte keine Rolle für eine Zielreferenz; das Modell musste sie in `base`
   oder `identity_reference` pressen — und nahm dann das Gesicht von dort.

Die Lösung besteht aus vier Teilen:

- **Rollentexte identitätsfähig machen:** `ausgang` sagt ausdrücklich, dass eine
  abgebildete Person *die* Person des Ergebnisses ist; `ziel` sagt, dass eine dort
  sichtbare Person nur Platzhalter für Ausschnitt, Pose und Licht ist.
- **Neue Rolle `look_reference`** im JSON-Schema des Prompt-Schreibers.
- **`preserve` erzwingen**, sobald Ausgangsmaterial vorhanden ist.
- **`identitaetsKlausel()` ans Ende des Prompts**, mit den konkreten Bildnummern. Ans
  Ende, weil beim Bildmodell das zuletzt Gelesene schwerer wiegt.

**Der Gesicht-Lock setzt sich selbst**, wenn der Auftragstext ihn sinngemäß verlangt
(„Gesicht von der Vorlage", „gleiche Person", „keep the face from the source"). Die
Muster in `identitaet.ts` sind bewusst eng gefasst — ein Gesicht-Lock auf einem
Produktfoto macht den Prompt schlechter, nicht besser. Gegenproben mitportieren.

### B5 — Identität ist nicht Dateiqualität

Direkte Folge von B4, und ein Fehler, den man beim Nachbauen sicher wiederholt:

Nachdem B4 eingebaut war, kam das richtige Gesicht — aber **voller dunkler Flecken**.
Grund: Die Regel verlangte, die Vorlage „exakt" zu übernehmen *und* scharfes Detail zu
rekonstruieren. Ein stark komprimiertes JPEG hat Blockartefakte und Farbrauschen; das
Modell hielt sie für Hautmerkmale und malte sie groß und scharf aus.

Rollentext und Klausel müssen deshalb **zwei Dinge trennen**:

- **WER** die Person ist (Geometrie, Proportionen, Merkmale, Hautton, Haare) kommt aus
  der Vorlage.
- **WIE SAUBER** das Bild ist, kommt *nicht* aus der Vorlage. Kompressionsartefakte,
  Blockbildung, Farbrauschen, Banding und Unschärfe sind Fehler der **Datei** und dürfen
  nicht als Flecken oder Verfärbungen erscheinen.

Beides ist als Fehlschlag zu benennen: ein wächsernes Gesicht **und** ein fleckiges.

### B6 — Kleinigkeiten mit spürbarer Wirkung

- **`compressImage` schont kleine Bilder.** Vorher lief jedes hochgeladene Bild durch
  JPEG 0.85 — auch ein 12-KB-Thumbnail, das dadurch weiter verlor. Jetzt: Wenn das Bild
  ohnehin unter der Maximalkante liegt und klein genug ist, unverändert durchlassen.
- **Auflösungswarnung an der Bildkarte.** Pixelmaße neben der Dateigröße, Hinweis unter
  900 px kurzer Kante, rot unter 500 px. Der Hinweis gehört **vor** die Generierung.
- **Stilanalyse einer Referenzgrafik** (`server/grafik.ts` im Quellprojekt): Ein
  Sehmodell liest eine hochgeladene Referenz aus und füllt damit ein Formular vor. Das
  Muster ist übertragbar, die Kategorien darin sind es nicht — die sind kundenspezifisch.

---

## Teil C — Wie man prüft, ob es wirklich sitzt

Im Quellprojekt wurde jede der Änderungen belegt, nicht nur behauptet. Dieselben
Prüfungen lohnen hier.

**Auth (B0).** Eine Tabelle von Konfigurationen durchspielen und feststellen, was
`requireAuth` tut. Zehn Fälle, die alle blockieren müssen (bis auf den einen, der lokal
offen sein darf):

| Fall | erwartet |
|---|---|
| alles richtig, kein Cookie | 401 |
| `AUTH_USERS` kaputtes JSON | 503 |
| `AUTH_SECRET` fehlt | 503 |
| `AUTH_USERS` leerer String | 503 |
| `AUTH_USERS` leeres Array | 503 |
| gar nichts gesetzt, `VERCEL=1` | 503 |
| Eintrag ohne `scrypt$`-Hash | 503 |
| richtig gesetzt, kaputtes Cookie | 401 (nicht 500!) |
| gar nichts gesetzt, lokal | durchgelassen — so gewollt |

Technik: `server/auth.ts` mehrfach mit wechselnden Umgebungsvariablen importieren
(`await import(pfad + '?v=' + n)` umgeht den Modul-Cache), `requireAuth` mit einem
Attrappen-`req`/`res` aufrufen.

**Bremse.** Neunmal mit falschem Passwort, dann muss 429 kommen; danach mit richtigem
Passwort von einer **anderen** IP — das muss durchgehen, sonst ist die Kontogrenze zu eng.

**Modelle.** Ein echter Aufruf gegen jede neue Modell-ID. Ohne den weiß man nicht, ob
die Kennung stimmt. Das war im Quellprojekt der eine ungeprüfte Punkt.

**Gesicht-Lock-Erkennung.** Zehn Sätze, die auslösen müssen, und sieben, die es nicht
dürfen. Eine zu weite Erkennung ist schlimmer als eine zu enge.

---

## Teil D — Reihenfolge

1. **B0** (Sicherheit) — unabhängig von allem anderen, sofort.
2. **B1 + B2** (Modelle und Auswahl) — die sichtbarste Verbesserung.
3. **B3** (Rollen) — Grundlage für B4/B5.
4. **B4 + B5** (Identität) — nur sinnvoll nach B3.
5. **B6** — wenn Zeit ist.

---

## Was dieses Projekt sonst noch gebrauchen könnte

Beim Durchsehen aufgefallen, ohne Bezug zum Quellprojekt:

- Im Projektordner liegen zwei erzeugte Bilder (`generated-*.jpeg`, zusammen ~10 MB),
  die dort nicht hingehören.
- `.env` ist ein Symlink nach `~/.secrets/...` — gute Lösung, sollte so bleiben.
- Der Ordnername endet auf ein **Leerzeichen** („Prompt & Image Generator "). Das bricht
  Skripte, die Pfade nicht sauber quoten. Umbenennen wäre eine Überlegung wert.

import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { mountAuthRoutes, requireAuth } from '../server/auth.js'
import { holeBild } from '../server/bildholen.js'
import { pruefeErgebnis } from '../server/pruefung.js'
import { optimierePrompt } from '../server/optimieren.js'
import { analyzeImages } from '../server/analyze.js'
import { generateImage } from '../server/generate.js'

const app = express()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase()
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf']
    cb(null, allowed.includes(file.mimetype) || allowedExts.includes(ext))
  },
})

app.use(cors())
app.use(express.json({ limit: '100mb' }))

// Auth endpoints (login/logout/me) — no-op if AUTH_USERS env not set
mountAuthRoutes(app)

// ── Analyse ─────────────────────────────────────────────────────────────────
//
// Hier stand bis eben eine zweite, vollständige Kopie des Prompt-Schreibers:
// eigener System-Prompt, eigene Bildindex- und Rollenbausteine, eigener
// Aufruf. Zwei Fassungen desselben Verfahrens laufen unweigerlich
// auseinander — und weil DIESE hier im Betrieb läuft, hätte die Seite still
// anders gearbeitet als die lokale. Jetzt gibt es nur noch eine Fassung, in
// server/analyze.ts.
app.post('/api/analyze', requireAuth, upload.array('images', 10), analyzeImages)

// ── Generieren ──────────────────────────────────────────────────────────────
//
// Auch hier stand eine zweite, vollständige Kopie von server/generate.ts —
// eigene Modellliste, eigene Aufrufe. Neue Modelle (zuletzt Nano Banana 2.1)
// mussten an beiden Stellen nachgetragen werden; wer eine vergass, hatte lokal
// ein Modell, das es im Betrieb nicht gab. Jetzt gibt es nur eine Fassung.
app.post('/api/generate', requireAuth, generateImage)

// Bild von einer Adresse holen — für das Einfügen aus dem Browser, wenn in der
// Zwischenablage nur ein Verweis statt eines Bildes liegt.
app.post('/api/bild-holen', requireAuth, holeBild)
// Das erzeugte Bild gegen Referenzen und Auftrag halten — die Grundlage
// fürs Nachschärfen.
app.post('/api/pruefen', requireAuth, pruefeErgebnis)
// Den Prompt selbst verbessern, wenn ein Ergebnis nicht getaugt hat.
app.post('/api/optimieren', requireAuth, optimierePrompt)

export default app

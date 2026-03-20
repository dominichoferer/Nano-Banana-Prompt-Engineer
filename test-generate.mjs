// test-generate.mjs — Gemini Image Generation Test
// Ausführen: node test-generate.mjs

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ── API Key aus .env laden (ohne dotenv dependency) ───────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '.env')

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [key, ...valueParts] = trimmed.split('=')
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim()
    }
  }
}

// ── Konfiguration ─────────────────────────────────────────────────────────────
const API_KEY = process.env.GOOGLE_AI_API_KEY
if (!API_KEY || API_KEY === 'your_google_ai_studio_api_key_here') {
  console.error('❌ GOOGLE_AI_API_KEY fehlt oder ist noch der Platzhalter in .env')
  process.exit(1)
}

const PROMPT = 'Ein futuristischer Mercedes CLA Shooting Brake in einer Cyberpunk-Stadt, neon lights, regennasse Straße, cinematic, ultra detailed'
const MODEL  = 'gemini-3-pro-image-preview'

// Beste Qualität: aspectRatio + Qualitätsbeschreibung im Prompt
const IMAGE_CONFIG = {
  aspectRatio: '16:9',   // Unterstützte Werte: 1:1 | 16:9 | 9:16 | 4:3 | 3:4
}

// ── API Call ──────────────────────────────────────────────────────────────────
const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`

console.log(`\n🍌 Gemini Image Generation Test`)
console.log(`   Modell:    ${MODEL}`)
console.log(`   Format:    ${IMAGE_CONFIG.aspectRatio}`)
console.log(`   Prompt:    "${PROMPT.slice(0, 60)}…"\n`)
console.log(`⏳ Generiere Bild…\n`)

let response
try {
  response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }] }],
      // Testing new SDK equivalent: image_config with image_size
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '4K',
        },
      },
    }),
  })
} catch (err) {
  console.error('❌ Netzwerkfehler:', err.message)
  process.exit(1)
}

const data = await response.json()

// ── Fehler auswerten ──────────────────────────────────────────────────────────
if (!response.ok) {
  const msg = data?.error?.message || `HTTP ${response.status}`
  console.error('❌ API Fehler:', msg)

  if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
    console.error('   → Quota überschritten. Billing in Google Cloud aktivieren:')
    console.error('     https://console.cloud.google.com/billing')
  } else if (msg.includes('API_KEY_INVALID')) {
    console.error('   → Key ungültig. Prüfe den Key in .env')
  } else if (msg.includes('SAFETY')) {
    console.error('   → Prompt von Safety-Filter blockiert. Prompt anpassen.')
  }
  process.exit(1)
}

// ── Bild extrahieren und speichern ────────────────────────────────────────────
const parts = data.candidates?.[0]?.content?.parts ?? []
const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'))

if (!imgPart?.inlineData) {
  console.error('❌ Kein Bild in der Antwort. Volle Antwort:')
  console.error(JSON.stringify(data, null, 2))
  process.exit(1)
}

const ext      = imgPart.inlineData.mimeType.split('/')[1] || 'jpg'
const filename = `generated-${Date.now()}.${ext}`
const buffer   = Buffer.from(imgPart.inlineData.data, 'base64')
fs.writeFileSync(filename, buffer)

console.log(`✅ Bild gespeichert: ${filename}`)
console.log(`   Größe: ${(buffer.length / 1024).toFixed(0)} KB`)
console.log(`   MIME:  ${imgPart.inlineData.mimeType}`)

// Textantwort wenn vorhanden
const textPart = parts.find(p => p.text)
if (textPart?.text) {
  console.log(`   Text:  "${textPart.text.slice(0, 100)}"`)
}

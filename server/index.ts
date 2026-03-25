import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import { analyzeImages } from './analyze.js'
import { generateImage } from './generate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()

// Multer: memory storage, max 10 files, 50MB each
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
    // Also allow by extension when MIME type is missing (e.g. drag-and-drop on macOS)
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase()
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf']
    if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`))
    }
  }
})

app.use(cors())
app.use(express.json({ limit: '100mb' }))

// API Routes
app.post('/api/analyze', upload.array('images', 10), analyzeImages)
app.post('/api/generate', generateImage)

// Serve React build in production
const clientBuildPath = path.join(__dirname, '../client')
app.use(express.static(clientBuildPath))
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'))
})

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001

app.listen(PORT, () => {
  console.log(`🍌 Nano Banana Prompt Engineer`)
  console.log(`   Server running on http://localhost:${PORT}`)
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('   ⚠️  ANTHROPIC_API_KEY not set — prompt analysis will fail')
  }
  if (!process.env.GOOGLE_AI_API_KEY) {
    console.warn('   ⚠️  GOOGLE_AI_API_KEY not set — image generation will fail')
  }
})

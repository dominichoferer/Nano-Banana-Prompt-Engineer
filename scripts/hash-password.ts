#!/usr/bin/env tsx
// Build the AUTH_USERS env JSON for Vercel.
// Usage:
//   Interactive:  npm run hash-password
//   One-shot:     npm run hash-password -- email1@heron.at:pass1 email2@heron.at:pass2

import { hashPassword } from '../server/auth.js'
import { createInterface } from 'readline'
import { randomBytes } from 'crypto'

async function readPairsFromStdin(): Promise<Array<[string, string]>> {
  const rl = createInterface({ input: process.stdin, terminal: false })
  const pairs: Array<[string, string]> = []
  let email: string | null = null

  process.stdout.write('\nHeron AI Studio — Passwort-Hash-Generator\n')
  process.stdout.write('─────────────────────────────────────────\n')
  process.stdout.write('Format pro Zeile entweder "email:passwort"\n')
  process.stdout.write('oder abwechselnd Email-Zeile dann Passwort-Zeile.\n')
  process.stdout.write('Leere Zeile zum Beenden.\n\n')

  for await (const raw of rl) {
    const line = raw.trim()
    if (!line) {
      if (email) { console.log('  → übersprungen (leeres Passwort)'); email = null }
      break
    }
    if (line.includes(':')) {
      const idx = line.indexOf(':')
      pairs.push([line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1)])
    } else if (!email) {
      email = line
    } else {
      pairs.push([email.toLowerCase(), line])
      email = null
    }
  }
  rl.close()
  return pairs
}

async function main() {
  const argPairs = process.argv.slice(2)
    .map((arg) => {
      const idx = arg.indexOf(':')
      if (idx < 0) return null
      return [arg.slice(0, idx).trim().toLowerCase(), arg.slice(idx + 1)] as [string, string]
    })
    .filter((p): p is [string, string] => !!p && !!p[0] && !!p[1])

  const pairs = argPairs.length > 0 ? argPairs : await readPairsFromStdin()

  if (pairs.length === 0) {
    console.error('Keine User angelegt.')
    process.exit(1)
  }

  const users = pairs.map(([email, password]) => ({ email, hash: hashPassword(password) }))

  console.log('\n─────────────────────────────────────────')
  console.log(`${users.length} User angelegt:`)
  for (const u of users) console.log(`  ✓ ${u.email}`)
  console.log('\nAUTH_USERS (Wert in Vercel ENV setzen):\n')
  console.log(JSON.stringify(users))
  console.log('\nAUTH_SECRET (zufällig generiert — auch in Vercel ENV setzen):\n')
  console.log(randomBytes(48).toString('base64'))
  console.log('\n─────────────────────────────────────────')
  console.log('Vercel Dashboard → Project Settings → Environment Variables → Production')
  console.log('Beide ENV-Variablen hinterlegen, dann neu deployen.\n')
}

main().catch((e) => { console.error(e); process.exit(1) })

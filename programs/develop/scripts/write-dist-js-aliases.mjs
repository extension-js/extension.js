import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.resolve(__dirname, '..', 'dist')

const stems = [
  'ensure-hmr-for-scripts',
  'minimum-script-file',
  'feature-scripts-content-script-wrapper',
  'main-world-bridge',
  'minimum-chromium-file',
  'minimum-firefox-file',
  'resolve-paths-loader'
]

// Windows + antivirus + multi-lib rslib output can briefly delay the moment a
// freshly-emitted .mjs becomes readable: the rslib summary lists the asset,
// the process exits 0, and our follow-up readFile still races a pending file
// handle (ENOENT). Linux/macOS never reproduces this. Retry with a short
// bounded backoff so the alias hop survives that gap without masking a real
// missing-output regression.
async function readFileWithRetries(filePath) {
  const maxAttempts = 10
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fs.readFile(filePath)
    } catch (error) {
      const isTransient =
        error?.code === 'ENOENT' ||
        error?.code === 'EBUSY' ||
        error?.code === 'EPERM'
      if (!isTransient || attempt === maxAttempts) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
    }
  }
  // Unreachable — the loop either returns or throws.
  throw new Error(`readFileWithRetries: exhausted attempts for ${filePath}`)
}

async function main() {
  await Promise.all(
    stems.map(async (stem) => {
      const mjsPath = path.join(distDir, `${stem}.mjs`)
      const jsPath = path.join(distDir, `${stem}.js`)
      const source = await readFileWithRetries(mjsPath)
      await fs.writeFile(jsPath, source)
    })
  )

  await fs.writeFile(
    path.join(distDir, 'package.json'),
    `${JSON.stringify({type: 'module'}, null, 2)}\n`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})

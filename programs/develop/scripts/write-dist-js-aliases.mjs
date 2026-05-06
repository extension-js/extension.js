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

async function main() {
  await Promise.all(
    stems.map(async (stem) => {
      const mjsPath = path.join(distDir, `${stem}.mjs`)
      const jsPath = path.join(distDir, `${stem}.js`)
      const source = await fs.readFile(mjsPath)
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

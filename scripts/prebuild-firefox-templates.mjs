// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templatesDir = path.join(root, 'templates')
const cli = path.join(root, 'programs', 'extension', 'bin', 'extension.cjs')

// The families templates/template.firefox.spec.ts sweeps. The examples repo
// builds every example for Firefox before its Firefox job; here the Chromium
// specs only ever built dist/chrome, so the sweeps saw whatever an earlier
// spec left behind and the new tab sweep found nothing at all.
const FAMILIES = [/^content(-|$)/, /^newtab(-|$)/, /^action$/, /^sidebar$/]
const SKIP = new Set(['content-main-world'])

export function firefoxTemplateSlugs(dir = templatesDir) {
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir, {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => FAMILIES.some((family) => family.test(name)))
    .filter((name) => !SKIP.has(name))
    .filter((name) =>
      fs.existsSync(path.join(dir, name, 'src', 'manifest.json'))
    )
    .sort()
}

function hasFirefoxBuild(slug) {
  return fs.existsSync(
    path.join(templatesDir, slug, 'dist', 'firefox', 'manifest.json')
  )
}

export function prebuildFirefoxTemplates() {
  const slugs = firefoxTemplateSlugs()
  const pending = slugs.filter((slug) => !hasFirefoxBuild(slug))

  console.log(
    `[prebuild-firefox] ${slugs.length} templates in the Firefox sweep, ${pending.length} to build`
  )

  const failed = []

  for (const slug of pending) {
    const started = Date.now()
    const result = spawnSync(
      process.execPath,
      [cli, 'build', path.join(templatesDir, slug), '--browser=firefox'],
      {
        cwd: root,
        encoding: 'utf-8',
        env: {
          ...process.env,
          EXTENSION_TELEMETRY_DISABLED: '1',
          // The hydrate script installed every template's deps already.
          EXTENSION_SKIP_INSTALL: process.env.EXTENSION_SKIP_INSTALL ?? '1'
        }
      }
    )

    const seconds = ((Date.now() - started) / 1000).toFixed(1)

    if (result.status === 0 && hasFirefoxBuild(slug)) {
      console.log(`[prebuild-firefox] ok   ${slug} (${seconds}s)`)
      continue
    }

    failed.push(slug)
    console.log(`[prebuild-firefox] FAIL ${slug} (${seconds}s)`)
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) console.error(result.error.message)
  }

  return {slugs, built: pending.length - failed.length, failed}
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const {failed} = prebuildFirefoxTemplates()

  if (failed.length > 0) {
    console.error(
      `[prebuild-firefox] ${failed.length} Firefox build(s) failed: ${failed.join(', ')}`
    )

    process.exit(1)
  }
}

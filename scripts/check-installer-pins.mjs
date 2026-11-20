// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))

export const VERSIONS_FILE = path.join(
  ROOT_DIR,
  'programs',
  'install',
  'lib',
  'installer-versions.ts'
)

// The package each pin names. A pin missing here fails the check, so a new
// one can never go unread.
export const PIN_PACKAGES = {
  PUPPETEER_BROWSERS_VERSION: '@puppeteer/browsers',
  PLAYWRIGHT_VERSION: 'playwright'
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const REQUEST_TIMEOUT_MS = 15_000
// A registry hiccup gets one more try. A 404 is an answer and gets none.
const ATTEMPTS = 2

export function readInstallerPins(source) {
  const pins = []
  const declaration = /^export const ([A-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]/gm

  for (const [, constant, version] of String(source).matchAll(declaration)) {
    pins.push({constant, version, name: PIN_PACKAGES[constant] ?? null})
  }

  return pins
}

// The registry's document for one version: a few kilobytes of metadata,
// never the package tarball.
export function versionUrl(registry, name, version) {
  const base = String(registry).replace(/\/+$/, '')

  return `${base}/${name.replaceAll('/', '%2f')}/${encodeURIComponent(version)}`
}

export async function checkPin(pin, options = {}) {
  const {
    registry = DEFAULT_REGISTRY,
    fetchImpl = fetch,
    timeoutMs = REQUEST_TIMEOUT_MS
  } = options

  if (!pin.name) {
    return {
      ...pin,
      ok: false,
      reason: `no package is known for ${pin.constant}. Add it to PIN_PACKAGES in scripts/check-installer-pins.mjs`
    }
  }

  const url = versionUrl(registry, pin.name, pin.version)
  const wanted = `${pin.name}@${pin.version}`
  let lastProblem = ''

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let response

    try {
      response = await fetchImpl(url, {
        headers: {accept: 'application/json'},
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (/** @type {any} */ error) {
      lastProblem = error?.message || String(error)

      continue
    }

    if (response.status === 404) {
      return {...pin, ok: false, reason: `${wanted} is not on ${registry}`}
    }

    if (!response.ok) {
      lastProblem = `HTTP ${response.status}`

      continue
    }

    let document

    try {
      document = await response.json()
    } catch {
      return {...pin, ok: false, reason: `${url} did not answer with JSON`}
    }

    if (document?.version !== pin.version) {
      return {
        ...pin,
        ok: false,
        reason: `${url} answered version ${document?.version ?? 'none'}`
      }
    }

    if (!document?.dist?.tarball) {
      return {...pin, ok: false, reason: `${wanted} lists no tarball`}
    }

    return {
      ...pin,
      ok: true,
      deprecated:
        typeof document.deprecated === 'string' ? document.deprecated : null
    }
  }

  return {
    ...pin,
    ok: false,
    reason: `couldn't read ${url} after ${ATTEMPTS} tries: ${lastProblem}`
  }
}

export async function checkInstallerPins(source, options = {}) {
  const pins = readInstallerPins(source)

  return Promise.all(pins.map((pin) => checkPin(pin, options)))
}

export function parseArgs(argv, env = process.env) {
  const options = {
    file: VERSIONS_FILE,
    registry:
      env.npm_config_registry || env.NPM_CONFIG_REGISTRY || DEFAULT_REGISTRY
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]

    if ((flag === '--file' || flag === '--registry') && value) {
      options[flag.slice(2)] = value
      i++

      continue
    }

    throw new Error(
      `unknown argument ${flag}. Usage: check-installer-pins.mjs [--file <path>] [--registry <url>]`
    )
  }

  return options
}

async function main() {
  const {file, registry} = parseArgs(process.argv.slice(2))
  const annotate = process.env.GITHUB_ACTIONS === 'true'
  const results = await checkInstallerPins(readFileSync(file, 'utf8'), {
    registry
  })

  if (results.length === 0) {
    console.error(`[installer-pins] FAILED: no pins found in ${file}`)
    process.exit(1)
  }

  for (const result of results) {
    const label = `${result.constant} ${result.name ?? '?'}@${result.version}`

    if (!result.ok) {
      console.error(`[installer-pins] ${label}: ${result.reason}`)
      if (annotate) console.log(`::error::${label}: ${result.reason}`)

      continue
    }

    console.log(`[installer-pins] ${label} resolves`)

    if (result.deprecated) {
      console.log(
        `[installer-pins] ${label} is deprecated: ${result.deprecated}`
      )

      if (annotate) console.log(`::warning::${label} is deprecated`)
    }
  }

  const failed = results.filter((result) => !result.ok).length

  if (failed > 0) {
    console.error(
      `[installer-pins] FAILED: ${failed} of ${results.length} pins don't resolve`
    )

    process.exit(1)
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`[installer-pins] FAILED: ${error?.message || error}`)
    process.exit(1)
  })
}

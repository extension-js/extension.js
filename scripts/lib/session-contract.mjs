// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// The sanctioned machine interface for harnesses: a session's ready.json and
// events.ndjson under dist/extension-js/<browser>, never the pretty stdout.
import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'

export function sessionArtifactsDir(projectDir, browser) {
  return join(projectDir, 'dist', 'extension-js', browser)
}

export function readyContractPath(projectDir, browser) {
  return join(sessionArtifactsDir(projectDir, browser), 'ready.json')
}

export function eventsContractPath(projectDir, browser) {
  return join(sessionArtifactsDir(projectDir, browser), 'events.ndjson')
}

// Null means "no readable contract yet"; pollers treat that as not-ready
// rather than as an error, because the writer creates the file mid-run.
export function readReadyContract(projectDir, browser) {
  const contractPath = readyContractPath(projectDir, browser)
  if (!existsSync(contractPath)) return null
  try {
    return JSON.parse(readFileSync(contractPath, 'utf-8'))
  } catch {
    return null
  }
}

export function readSessionEvents(projectDir, browser) {
  const contractPath = eventsContractPath(projectDir, browser)
  if (!existsSync(contractPath)) return []
  let raw = ''
  try {
    raw = readFileSync(contractPath, 'utf-8')
  } catch {
    return []
  }
  const events = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      // A row may be mid-append; skip it and keep the parsed timeline.
    }
  }
  return events
}

export function countCompileSuccessEvents(events, runId) {
  return events.filter(
    (event) =>
      event?.type === 'compile_success' && (!runId || event.runId === runId)
  ).length
}

// A contract written before this harness started belongs to an earlier
// session and must not drive (or fail) the current run.
export function isFreshContract(ready, notBeforeMs) {
  const startedAtMs = Date.parse(String(ready?.startedAt || ''))
  return Number.isFinite(startedAtMs) && startedAtMs >= notBeforeMs
}

// One line a thrown Error can carry so a contract-reported failure is as
// loud as the stdout token match it replaces.
export function describeReadyFailure(ready) {
  if (!ready) return 'ready.json is missing or unreadable'
  const parts = [`status=${ready.status}`]
  if (ready.code) parts.push(`code=${ready.code}`)
  if (ready.message) parts.push(`message=${ready.message}`)
  if (Array.isArray(ready.errors) && ready.errors.length > 0) {
    parts.push(`errors:\n  ${ready.errors.join('\n  ')}`)
  }
  return parts.join(' ')
}

function encodeChromiumExtensionIdFromDigest(digest) {
  let extensionId = ''
  for (const byte of digest) {
    extensionId += String.fromCharCode(97 + ((byte >> 4) & 0x0f))
    extensionId += String.fromCharCode(97 + (byte & 0x0f))
  }
  return extensionId
}

function deriveChromiumExtensionIdFromKey(distPath) {
  try {
    const manifest = JSON.parse(
      readFileSync(join(distPath, 'manifest.json'), 'utf-8')
    )
    const key = typeof manifest?.key === 'string' ? manifest.key.trim() : ''
    if (!key) return ''
    const decodedKey = Buffer.from(key.replace(/\s+/g, ''), 'base64')
    if (!decodedKey.length) return ''
    const digest = createHash('sha256')
      .update(decodedKey)
      .digest()
      .subarray(0, 16)
    return encodeChromiumExtensionIdFromDigest(digest)
  } catch {
    return ''
  }
}

// Mirror Chrome's id_util::GenerateIdForPath: `key` wins when the manifest
// pins one, otherwise the deterministic hash of the absolute dist path.
export function expectedChromiumExtensionId(distPath) {
  if (!distPath || typeof distPath !== 'string') return ''
  const fromKey = deriveChromiumExtensionIdFromKey(distPath)
  if (fromKey) return fromKey
  try {
    const absolute = resolve(distPath)
    const seedBuffer =
      process.platform === 'win32'
        ? Buffer.from(absolute.replace(/\//g, '\\'), 'utf16le')
        : Buffer.from(absolute, 'utf8')
    const digest = createHash('sha256')
      .update(seedBuffer)
      .digest()
      .subarray(0, 16)
    return encodeChromiumExtensionIdFromDigest(digest)
  } catch {
    return ''
  }
}

// The managed profile the launcher provisions beside the session artifacts.
export function managedProfileDir(distPath, browser) {
  return join(
    dirname(distPath),
    'extension-js',
    'profiles',
    `${browser}-profile`
  )
}

//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import colors from 'pintor'

type TelemetryInit = {
  app: string
  version: string
  apiKey?: string
  host?: string
  disabled?: boolean
}

type CommonProps = {
  app: string
  version: string
  os: string
  arch: string
  node: string
  is_ci: boolean
  schema_version: number
}

type TelemetryStorage = {
  telemetryDir: string
  auditFile: string
  idFile: string
  consentFile: string
}

function isCI(): boolean {
  const v = process.env
  return Boolean(
    v.CI ||
    v.GITHUB_ACTIONS ||
    v.GITLAB_CI ||
    v.BUILDKITE ||
    v.CIRCLECI ||
    v.TRAVIS
  )
}

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) return path.join(xdg, 'extensionjs')

  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'extensionjs')
  }

  return path.join(os.homedir(), '.config', 'extensionjs')
}

function cacheDir(): string | null {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg) return path.join(xdg, 'extensionjs')

  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA
    if (base) return path.join(base, 'extensionjs', 'Cache')
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'extensionjs')
  }

  return null
}

function ensureDir(p: string): boolean {
  try {
    if (fs.existsSync(p)) return true
    fs.mkdirSync(p, {recursive: true})
    return true
  } catch {
    return false
  }
}

function ensureWritableDir(p: string): boolean {
  if (!ensureDir(p)) return false
  try {
    fs.accessSync(p, fs.constants.W_OK)
    const probe = path.join(p, `.write-test-${process.pid}-${Date.now()}`)
    fs.writeFileSync(probe, 'ok', 'utf8')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

function loadOrCreateId(file: string): string {
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
  } catch {
    // ignore read errors and fall back to generating a new id
  }

  const id = crypto.randomUUID()

  if (ensureDir(path.dirname(file))) {
    try {
      fs.writeFileSync(file, id, 'utf8')
    } catch {
      // ignore write errors and return ephemeral id
    }
  }

  return id
}

function telemetryCandidates(): string[] {
  const candidates = [
    configDir(),
    cacheDir(),
    path.join(os.tmpdir(), 'extensionjs'),
    path.join(process.cwd(), '.cache', 'extensionjs')
  ].filter(Boolean) as string[]

  return Array.from(new Set(candidates))
}

function resolveTelemetryStorage(): TelemetryStorage | null {
  for (const base of telemetryCandidates()) {
    const telemetryDir = path.join(base, 'telemetry')
    if (!ensureWritableDir(telemetryDir)) continue
    return {
      telemetryDir,
      auditFile: path.join(telemetryDir, 'events.jsonl'),
      idFile: path.join(telemetryDir, 'anonymous-id'),
      consentFile: path.join(telemetryDir, 'consent')
    }
  }
  return null
}

const DEFAULT_FLUSH_AT = Number(process.env.EXTENSION_TELEMETRY_FLUSH_AT || 10)
const DEFAULT_FLUSH_INTERVAL = Number(
  process.env.EXTENSION_TELEMETRY_FLUSH_INTERVAL || 2000
)
const DEFAULT_TIMEOUT_MS = Number(
  process.env.EXTENSION_TELEMETRY_TIMEOUT_MS || 200
)
const DEFAULT_POSTHOG_KEY = 'phc_Np5x3Jg3h2V7kTFtNch2uz6QBaWDycQpIidzX5PetaN'
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

export class Telemetry {
  private anonId: string
  private common: CommonProps
  private debug: boolean
  private disabled: boolean
  private apiKey?: string
  private host?: string
  private storage: TelemetryStorage | null = null
  private buffer: Array<{
    event: string
    properties: Record<string, unknown>
    distinct_id: string
  }> = []
  private timer: NodeJS.Timeout | null = null

  constructor(init: TelemetryInit) {
    this.debug = process.env.EXTENSION_TELEMETRY_DEBUG === '1'
    this.disabled = Boolean(init.disabled)

    // When telemetry is disabled, avoid creating or reading any identifiers
    this.anonId = 'disabled'
    if (!this.disabled) {
      this.storage = resolveTelemetryStorage()
      if (!this.storage) {
        this.disabled = true
      } else {
        this.anonId = loadOrCreateId(this.storage.idFile)
      }
    }

    this.common = {
      app: init.app,
      version: init.version,
      os: process.platform,
      arch: process.arch,
      node: process.versions.node,
      is_ci: isCI(),
      schema_version: 1
    }

    this.apiKey = init.apiKey || DEFAULT_POSTHOG_KEY
    this.host = init.host || DEFAULT_POSTHOG_HOST

    // First-run consent marker (non-blocking, no prompt here; just record anonymous opt-in once)
    // Only record consent when telemetry is enabled.
    if (!this.disabled && this.storage) {
      const consentPath = this.storage.consentFile
      try {
        if (!fs.existsSync(consentPath)) {
          fs.writeFileSync(consentPath, 'ok', 'utf8')
          this.track('cli_telemetry_consent', {value: 'implicit_opt_in'})
          console.log(
            `${colors.gray('►►►')} Telemetry is enabled for Extension.js. To opt out, run with --no-telemetry. Learn more in TELEMETRY.md.`
          )
        }
      } catch {
        // swallow — best-effort consent marker
      }
    }
  }

  track(event: string, props: Record<string, unknown> = {}) {
    if (this.disabled || !this.storage) return

    const payload = {
      event,
      // $ip: null prevents IP storage on the server even if project settings change
      properties: {...this.common, ...props, $ip: null as unknown as undefined},
      distinct_id: this.anonId
    }

    try {
      fs.appendFileSync(this.storage.auditFile, JSON.stringify(payload) + '\n')
    } catch {
      // Stop telemetry if we can no longer write locally
      this.disabled = true
      return
    }

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[telemetry]', JSON.stringify(payload))
    }

    // No network configured; skip sending
    if (!this.apiKey || !this.host) return

    // `cli_shutdown` is emitted from a `beforeExit` hook. Scheduling a timer here
    // would keep the event loop alive and can re-trigger `beforeExit` repeatedly.
    if (event === 'cli_shutdown') {
      this.buffer.push(payload)
      return
    }

    this.buffer.push(payload)
    if (this.buffer.length >= DEFAULT_FLUSH_AT) {
      void this.flush()
      return
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        void this.flush()
      }, DEFAULT_FLUSH_INTERVAL)
    }
  }

  async flush() {
    if (this.disabled || !this.apiKey || !this.host) return
    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0, this.buffer.length)
    try {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS)
      const url = new URL('/capture/', this.host)
      await fetch(url.toString(), {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          api_key: this.apiKey,
          batch: batch.map((e) => ({
            event: e.event,
            properties: e.properties,
            distinct_id: e.distinct_id
          }))
        }),
        signal: ac.signal,
        // Best effort; avoid keeping the process alive
        keepalive: true as unknown as boolean
      }).catch(() => {})
      clearTimeout(t)
    } catch {
      // swallow — best-effort
    }
  }

  shutdown() {
    // no-op
  }
}

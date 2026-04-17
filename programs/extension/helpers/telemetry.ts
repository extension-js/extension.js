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

export type TelemetryEvent = 'command_executed' | 'command_failed'

export type TelemetryProps = {
  command: string
  success: boolean
  version: string
}

export type TelemetrySource = 'env' | 'flag' | 'config' | 'default'

type TelemetryInit = {
  app: string
  version: string
  apiKey?: string
  host?: string
  disabled?: boolean
  sampleRate?: number
  maxEventsPerRun?: number
  debounceMs?: number
}

type TelemetryStorage = {
  telemetryDir: string
  auditFile: string
  idFile: string
  consentFile: string
}

const DEFAULT_SAMPLE_RATE = Number(
  process.env.EXTENSION_TELEMETRY_SAMPLE_RATE || 0.2
)
const DEFAULT_MAX_EVENTS = Number(
  process.env.EXTENSION_TELEMETRY_MAX_EVENTS || 3
)
const DEFAULT_DEBOUNCE_MS = Number(
  process.env.EXTENSION_TELEMETRY_DEBOUNCE_MS || 60_000
)
const DEFAULT_TIMEOUT_MS = Number(
  process.env.EXTENSION_TELEMETRY_TIMEOUT_MS || 300
)
const DEFAULT_POSTHOG_KEY = process.env.POSTHOG_KEY || ''
const DEFAULT_POSTHOG_HOST =
  process.env.POSTHOG_HOST || 'https://us.i.posthog.com'

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

function telemetryCandidates(): string[] {
  const candidates = [
    configDir(),
    cacheDir(),
    path.join(os.tmpdir(), 'extensionjs'),
    path.join(process.cwd(), '.cache', 'extensionjs')
  ].filter(Boolean) as string[]
  return Array.from(new Set(candidates))
}

export function resolveTelemetryStorage(): TelemetryStorage | null {
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

function loadOrCreateId(file: string): string {
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
  } catch {
    // fall through to generating a new id
  }

  const id = crypto.randomUUID()
  if (ensureDir(path.dirname(file))) {
    try {
      fs.writeFileSync(file, id, 'utf8')
    } catch {
      // ephemeral id is still valid for this run
    }
  }
  return id
}

function readConsentFile(file: string): 'enabled' | 'disabled' | null {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim().toLowerCase()
    if (raw === 'enabled' || raw === 'ok' || raw === 'on' || raw === '1') {
      return 'enabled'
    }
    if (raw === 'disabled' || raw === 'off' || raw === '0' || raw === 'no') {
      return 'disabled'
    }
  } catch {
    // missing or unreadable — treat as unset
  }
  return null
}

function envDisables(): boolean {
  // Next.js-style presence flag: any truthy value disables.
  const disabled = String(process.env.EXTENSION_TELEMETRY_DISABLED ?? '')
    .trim()
    .toLowerCase()
  if (
    disabled === '1' ||
    disabled === 'true' ||
    disabled === 'on' ||
    disabled === 'yes'
  ) {
    return true
  }

  // Back-compat with the original `EXTENSION_TELEMETRY=0` form.
  const raw = String(process.env.EXTENSION_TELEMETRY ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return false
  return raw === '0' || raw === 'false' || raw === 'off' || raw === 'no'
}

export function resolveTelemetryConsent(argv: string[] = process.argv): {
  enabled: boolean
  source: TelemetrySource
} {
  if (envDisables()) return {enabled: false, source: 'env'}
  if (argv.includes('--no-telemetry')) return {enabled: false, source: 'flag'}

  const storage = resolveTelemetryStorage()
  if (storage) {
    const stored = readConsentFile(storage.consentFile)
    if (stored === 'enabled') return {enabled: true, source: 'config'}
    if (stored === 'disabled') return {enabled: false, source: 'config'}
  }

  return {enabled: true, source: 'default'}
}

export function writeConsent(value: 'enabled' | 'disabled'): boolean {
  const storage = resolveTelemetryStorage()
  if (!storage) return false
  try {
    fs.writeFileSync(storage.consentFile, value, 'utf8')
    return true
  } catch {
    return false
  }
}

export class Telemetry {
  private disabled: boolean
  private version: string
  private app: string
  private apiKey: string
  private host: string
  private anonId: string = 'disabled'
  private storage: TelemetryStorage | null = null
  private sent = 0
  private readonly sampleRate: number
  private readonly maxEventsPerRun: number
  private readonly debounceMs: number
  private readonly debug: boolean
  private readonly common: {
    os: NodeJS.Platform
    arch: string
    node_major: number
    is_ci: boolean
  }
  private recent = new Map<string, number>()
  private buffer: Array<{
    event: TelemetryEvent
    properties: Record<string, unknown>
    distinct_id: string
  }> = []

  constructor(init: TelemetryInit) {
    this.debug = process.env.EXTENSION_TELEMETRY_DEBUG === '1'
    this.disabled = Boolean(init.disabled)
    this.app = init.app
    this.version = init.version
    this.apiKey = init.apiKey ?? DEFAULT_POSTHOG_KEY
    this.host = init.host ?? DEFAULT_POSTHOG_HOST
    this.sampleRate = clamp(init.sampleRate ?? DEFAULT_SAMPLE_RATE, 0, 1)
    this.maxEventsPerRun = Math.max(
      0,
      init.maxEventsPerRun ?? DEFAULT_MAX_EVENTS
    )
    this.debounceMs = Math.max(0, init.debounceMs ?? DEFAULT_DEBOUNCE_MS)
    this.common = {
      os: process.platform,
      arch: process.arch,
      node_major: Number(String(process.versions.node).split('.')[0]) || 0,
      is_ci: isCI()
    }

    if (!this.disabled) {
      this.storage = resolveTelemetryStorage()
      if (this.storage) {
        this.anonId = loadOrCreateId(this.storage.idFile)
      }
    }
  }

  get isEnabled(): boolean {
    return !this.disabled
  }

  track(event: TelemetryEvent, props: TelemetryProps): void {
    try {
      if (this.disabled) return
      if (this.sent >= this.maxEventsPerRun) return

      const key = `${event}|${props.command}|${props.success}`
      const now = Date.now()
      const last = this.recent.get(key)
      if (last != null && now - last < this.debounceMs) return
      this.recent.set(key, now)

      const enforcedProps: TelemetryProps = {
        command: String(props.command ?? 'unknown').slice(0, 32),
        success: Boolean(props.success),
        version: String(props.version ?? this.version).slice(0, 32)
      }

      const payload = {
        event,
        properties: {
          ...enforcedProps,
          ...this.common,
          app: this.app,
          $ip: null as unknown as undefined
        },
        distinct_id: this.anonId
      }

      this.writeAudit(payload)

      if (event === 'command_executed' && Math.random() > this.sampleRate) {
        return
      }

      if (!this.apiKey || !this.host) return

      this.buffer.push(payload)
      this.sent += 1
    } catch {
      // telemetry must never crash the CLI
    }
  }

  async flush(): Promise<void> {
    try {
      if (this.disabled || !this.apiKey || !this.host) return
      if (this.buffer.length === 0) return

      const batch = this.buffer.splice(0, this.buffer.length)
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
        keepalive: true as unknown as boolean
      }).catch(() => {})

      clearTimeout(t)
    } catch {
      // best-effort — never crash
    }
  }

  shutdown(): void {
    // no-op; flush is async and the caller awaits it on beforeExit
  }

  private writeAudit(payload: unknown): void {
    if (!this.storage) return
    try {
      fs.appendFileSync(this.storage.auditFile, JSON.stringify(payload) + '\n')
    } catch {
      // if we can't audit locally, disable future sends too
      this.disabled = true
    }
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[telemetry]', JSON.stringify(payload))
    }
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

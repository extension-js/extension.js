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

function ensureDir(p: string) {
  if (fs.existsSync(p)) return

  fs.mkdirSync(p, {recursive: true})
}

function loadOrCreateId(file: string): string {
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()

  const id = crypto.randomUUID()

  ensureDir(path.dirname(file))
  fs.writeFileSync(file, id, 'utf8')

  return id
}

function auditFilePath(): string {
  const dir = path.join(configDir(), 'telemetry')

  ensureDir(dir)

  return path.join(dir, 'events.jsonl')
}

const DEFAULT_FLUSH_AT = Number(process.env.EXTENSION_TELEMETRY_FLUSH_AT || 10)
const DEFAULT_FLUSH_INTERVAL = Number(
  process.env.EXTENSION_TELEMETRY_FLUSH_INTERVAL || 2000
)
const DEFAULT_TIMEOUT_MS = Number(
  process.env.EXTENSION_TELEMETRY_TIMEOUT_MS || 200
)

export class Telemetry {
  private anonId: string
  private common: CommonProps
  private debug: boolean
  private disabled: boolean
  private apiKey?: string
  private host?: string
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
      const idFile = path.join(configDir(), 'telemetry', 'anonymous-id')
      this.anonId = loadOrCreateId(idFile)
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

    this.apiKey = init.apiKey || process.env.EXTENSION_PUBLIC_POSTHOG_KEY
    this.host = init.host || process.env.EXTENSION_PUBLIC_POSTHOG_HOST

    // First-run consent marker (non-blocking, no prompt here; just record anonymous opt-in once)
    // Only record consent when telemetry is enabled.
    if (!this.disabled) {
      const consentPath = path.join(configDir(), 'telemetry', 'consent')

      if (!fs.existsSync(consentPath)) {
        fs.writeFileSync(consentPath, 'ok', 'utf8')
        this.track('cli_telemetry_consent', {value: 'implicit_opt_in'})

        console.log(
          `${colors.gray('►►► system')} [extension] anonymous telemetry helps us improve. Pass --no-telemetry to opt out. Read more in TELEMETRY.md.`
        )
      }
    }
  }

  track(event: string, props: Record<string, unknown> = {}) {
    if (this.disabled) return

    const payload = {
      event,
      // $ip: null prevents IP storage on the server even if project settings change
      properties: {...this.common, ...props, $ip: null as unknown as undefined},
      distinct_id: this.anonId
    }

    fs.appendFileSync(auditFilePath(), JSON.stringify(payload) + '\n')

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[telemetry]', JSON.stringify(payload))
    }

    // No network configured; skip sending
    if (!this.apiKey || !this.host) return

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

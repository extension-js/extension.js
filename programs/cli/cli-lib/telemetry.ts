import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {PostHog} from 'posthog-node'

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

export class Telemetry {
  private client: PostHog | null
  private anonId: string
  private common: CommonProps
  private debug: boolean
  private disabled: boolean

  constructor(init: TelemetryInit) {
    this.debug = process.env.EXTENSION_TELEMETRY_DEBUG === '1'
    this.disabled = Boolean(init.disabled)

    const idFile = path.join(configDir(), 'telemetry', 'anonymous-id')
    this.anonId = loadOrCreateId(idFile)

    this.common = {
      app: init.app,
      version: init.version,
      os: process.platform,
      arch: process.arch,
      node: process.versions.node,
      is_ci: isCI(),
      schema_version: 1
    }

    const key = init.apiKey || process.env.EXTENSION_PUBLIC_POSTHOG_KEY
    const host = init.host || process.env.EXTENSION_PUBLIC_POSTHOG_HOST

    this.client =
      !this.disabled && key && host
        ? new PostHog(key, {host, flushAt: 10, flushInterval: 2000})
        : null

    // First-run consent marker (non-blocking, no prompt here; just record anonymous opt-in once)
    // Only record consent when telemetry is enabled.
    if (!this.disabled) {
      const consentPath = path.join(configDir(), 'telemetry', 'consent')

      if (fs.existsSync(consentPath)) return

      fs.writeFileSync(consentPath, 'ok', 'utf8')
      this.track('cli_telemetry_consent', {value: 'implicit_opt_in'})

      console.log(
        '[extension] anonymous telemetry helps us improve. Pass --no-telemetry to opt out. Read more in TELEMETRY.md.'
      )
    }
  }

  track(event: string, props: Record<string, unknown> = {}) {
    if (this.disabled) return

    const payload = {
      event,
      // $ip: null prevents IP storage on the server even if project settings change
      properties: {...this.common, ...props, $ip: null as unknown as undefined},
      distinctId: this.anonId
    }

    fs.appendFileSync(auditFilePath(), JSON.stringify(payload) + '\n')

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[telemetry]', JSON.stringify(payload))
    }

    if (this.client) this.client.capture(payload)
  }

  async flush() {
    if (!this.client) return

    const c: any = this.client as any
    if (typeof c.flushAsync === 'function') {
      await c.flushAsync()
      return
    }

    if (typeof c.flush === 'function') {
      const maybePromise = c.flush(() => {})
      if (maybePromise && typeof maybePromise.then === 'function') {
        await maybePromise
      }
    }
  }

  shutdown() {
    if (this.client) this.client.shutdown()
  }
}

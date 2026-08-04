//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type TelemetryEvent = 'command_executed' | 'command_failed'

export type TelemetryProps = {
  command: string
  success: boolean
  version: string
  template?: string
  source?: string
}

/* @invariant THIS CAP USED TO BE THIRTY-TWO AND IT WAS SILENTLY MANGLING THE
 * VERSION DIMENSION INTO SOMETHING THAT LOOKED LIKE A DIFFERENT BUILD.
 *
 * A published canary is stamped `<semver>-canary.<epoch>.<sha8>`, which is
 * thirty-three characters for a four-part semver, so the old cap removed the
 * last character of the sha. Read against the npm registry on 2026-07-30: every
 * canary version string in the ninety-day window that has no npm release is
 * exactly thirty-two characters long and is a strict prefix of one that does,
 * with no exceptions in twenty-one distinct strings. Thousands of ordinary
 * canary runs were therefore arriving under a version that has never been
 * published, which is the exact shape of a source build and is not one.
 *
 * Sixty-four matches `sanitizeTag` and leaves room for a longer prerelease. The
 * cap stays because an unbounded string from a package.json is still untrusted
 * input; what changes is that it now sits above the longest real value instead
 * of one character below it.
 */
const VERSION_MAX_LENGTH = 64

function sanitizeTag(value: string): string {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 64)
}

export type TelemetrySource = 'env' | 'flag' | 'config' | 'ci' | 'default'

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
const DEFAULT_AUDIT_MAX_BYTES = 1024 * 1024

function auditMaxBytes(): number {
  const raw = Number(process.env.EXTENSION_TELEMETRY_AUDIT_MAX_BYTES)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AUDIT_MAX_BYTES
}

export const DEFAULT_POSTHOG_KEY =
  process.env.POSTHOG_KEY || 'phc_Np5x3Jg3h2V7kTFtNch2uz6QBaWDycQpIidzX5PetaN'
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

/* @invariant A REGISTRY INSTALL ALWAYS SITS UNDER A PACKAGE-MANAGER DIRECTORY
 * AND A CHECKOUT OF THIS REPOSITORY NEVER DOES. THAT IS THE WHOLE TEST, AND IT
 * READS A PATH SHAPE RATHER THAN A PATH.
 *
 * npm, pnpm, yarn, bun and `npx` all land the package under a `node_modules`
 * segment, and the ones that do not use that name use a cache directory whose
 * name is in the list below. Running `extension` from a clone of
 * extension-js/extension.js resolves this module inside `programs/extension`,
 * with no such segment above it. So the emitted boolean answers "did this
 * invocation come from something a user installed" without the process ever
 * knowing, sending, or hashing where on disk it lives. Only the verdict leaves
 * the machine, so there is no new surface to consent to.
 *
 * WHY THE OBVIOUS DISCRIMINATOR IS THE WRONG ONE, and this is the reason the
 * property exists at all rather than being read off the version. It was put to
 * me that a canary version carrying a seven-character sha is provably a source
 * build because no such version exists on npm. Checked against the registry on
 * 2026-07-30 for every canary string in the ninety-day window: all twenty-one
 * are either published exactly, or are a strict prefix of a published version
 * whose sha is eight characters. Every single one of the "missing" strings is
 * exactly thirty-two characters long, and `track` used to cap `version` at
 * thirty-two. They are published builds truncated by this file, not source
 * builds, and inferring provenance from them would have relabelled thousands of
 * ordinary canary runs. The cap is now sixty-four, matching `sanitizeTag`, and
 * the provenance question is answered by something that actually knows.
 *
 * The honest limit: a yarn Plug'n'Play install resolves out of a zip and could
 * read as a checkout. `.yarn` is in the list for that reason, but treat the
 * false half of this boolean as "not a plain registry install" rather than as a
 * proven clone.
 */
const INSTALL_DIRECTORY_MARKERS = [
  'node_modules',
  '.pnpm',
  '.yarn',
  '.npm',
  '.bun'
]

export function isSourceCheckout(startDir: string = __dirname): boolean {
  const segments = String(startDir ?? '').split(/[\\/]+/)
  return !segments.some((segment) =>
    INSTALL_DIRECTORY_MARKERS.includes(segment)
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

// Telemetry state inside a git worktree arrived with a checkout, not with a
// person: a repo can commit its own XDG redirect target (a public repo
// shipped consent, one identity and 6 MB of events this way). Files there
// cannot speak for whoever cloned them. The walk stops at the home
// directory, a dotfiles repo rooted at ~ is the owner's own machine state.
export function isInsideGitWorkTree(startDir: string): boolean {
  const home = (() => {
    try {
      return path.resolve(os.homedir())
    } catch {
      return ''
    }
  })()
  let current = path.resolve(startDir)
  for (let i = 0; i < 100; i++) {
    if (home && current === home) return false
    try {
      if (fs.existsSync(path.join(current, '.git'))) return true
    } catch {
      // Ignore
    }
    const parent = path.dirname(current)
    if (parent === current) return false
    current = parent
  }
  return false
}

// A committed anonymous-id would aggregate every contributor into one
// distinct_id, so an id read from a worktree is re-keyed with a machine salt:
// stable per machine and checkout, distinct across machines, and never the
// raw committed value.
function machineScopedId(rawId: string): string {
  let salt = ''
  try {
    salt = `${os.hostname()}|${os.userInfo().username}`
  } catch {
    salt = String(os.hostname?.() || '')
  }
  const digest = crypto
    .createHash('sha256')
    .update(`${rawId}|${salt}`)
    .digest('hex')
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32)
  ].join('-')
}

export function loadOrCreateId(file: string): string {
  const inWorkTree = isInsideGitWorkTree(path.dirname(file))
  try {
    if (fs.existsSync(file)) {
      const stored = fs.readFileSync(file, 'utf8').trim()
      return inWorkTree ? machineScopedId(stored) : stored
    }
  } catch {
    // Ignore
  }

  const id = crypto.randomUUID()
  if (ensureDir(path.dirname(file))) {
    try {
      fs.writeFileSync(file, id, 'utf8')
    } catch {
      // Ignore
    }
  }
  return inWorkTree ? machineScopedId(id) : id
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
    // Ignore
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

function envExplicitlyEnables(): boolean {
  const raw = String(process.env.EXTENSION_TELEMETRY ?? '')
    .trim()
    .toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes'
}

/* @invariant A STORED `enabled` DOES NOT CARRY ACROSS INTO A PIPELINE, AND A
 * STORED `disabled` STILL WINS EVERYWHERE. THE TWO HALVES OF THE FILE ARE NOT
 * THE SAME KIND OF THING, WHICH IS WHY THIS IS A SPLIT AND NOT A REORDER.
 *
 * The hole, reproduced against published `extension@4.0.24` rather than
 * inferred: with an isolated config home, one ordinary run writes `enabled` to
 * `telemetry/consent` through the first-run notice, and a second run on that
 * same home with `CI=true` and nothing attached to stdout answers
 * `Telemetry: enabled (source: config)`. The CI gate never executed. A control
 * on a fresh home under the same environment answers `disabled`, so the gate
 * itself works and the stored branch was simply sitting above it. Most of the
 * fleet is unaffected because a GitHub-hosted runner gets a new home every run;
 * what leaks is self-hosted runners, baked container images, and any pipeline
 * that caches a home directory.
 *
 * The judgement, made deliberately. A consent file records exactly one thing,
 * that at some moment a person at that keyboard did not object. It cannot
 * record who is running now, so it cannot tell "I agreed at this machine" from
 * "a pipeline inherited my home directory". Consent that cannot name the run it
 * covers is not consent for that run, and a pipeline cannot agree to anything.
 * So a stored `enabled` is demoted BELOW the CI gate.
 *
 * A stored `disabled` is a refusal, which is a different act. A refusal does
 * not need re-confirming by the person who made it, and a blunt reorder would
 * have relabelled it `source: 'ci'` while silencing it for a different stated
 * reason. The reason is the part an audit reads, so `disabled` stays above
 * everything and keeps reporting `config`.
 *
 * Nothing legitimate loses its route. `EXTENSION_TELEMETRY=1` still sits above
 * both and is the deliberate machine-level opt-in a self-hosted runner or the
 * smoke job uses; that is what `telemetry-check.yml` sets. The gate remains
 * `isCI() && !process.stdout.isTTY`, unchanged, because a devcontainer or agent
 * sandbox sets a CI marker while a person watches a terminal.
 */
export function resolveTelemetryConsent(argv: string[] = process.argv): {
  enabled: boolean
  source: TelemetrySource
} {
  if (envDisables()) return {enabled: false, source: 'env'}
  if (argv.includes('--no-telemetry')) return {enabled: false, source: 'flag'}
  if (envExplicitlyEnables()) return {enabled: true, source: 'env'}

  const storage = resolveTelemetryStorage()
  const stored = storage ? readConsentFile(storage.consentFile) : null

  if (stored === 'disabled') return {enabled: false, source: 'config'}

  if (isCI() && !process.stdout.isTTY) return {enabled: false, source: 'ci'}

  // A consent file that lives inside a git worktree came with the clone, so
  // it cannot record this person's agreement and never yields `enabled`; it
  // falls through to the default, which shows the first-run notice. A stored
  // `disabled` above is a refusal and inheriting silence harms nobody.
  if (
    stored === 'enabled' &&
    storage &&
    !isInsideGitWorkTree(storage.telemetryDir)
  ) {
    return {enabled: true, source: 'config'}
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
    is_source_build: boolean
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
      is_ci: isCI(),
      is_source_build: isSourceCheckout()
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
        version: String(props.version ?? this.version).slice(
          0,
          VERSION_MAX_LENGTH
        )
      }
      if (props.template) enforcedProps.template = sanitizeTag(props.template)
      if (props.source) enforcedProps.source = sanitizeTag(props.source)

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

      if (
        event === 'command_executed' &&
        props.command !== 'create' &&
        Math.random() > this.sampleRate
      ) {
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
      // Ignore
    }
  }

  shutdown(): void {
    // no-op; flush is async and the caller awaits it on beforeExit
  }

  private writeAudit(payload: unknown): void {
    if (!this.storage) return
    this.rotateAuditIfNeeded(this.storage.auditFile)
    try {
      fs.appendFileSync(this.storage.auditFile, `${JSON.stringify(payload)}\n`)
    } catch {
      // if we can't audit locally, disable future sends too
      this.disabled = true
    }
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.error('[telemetry]', JSON.stringify(payload))
    }
  }

  // The audit log is write-only and must stay bounded: at the cap, roll to a
  // single .1 backup; files grossly over the cap are dropped, not kept.
  private rotateAuditIfNeeded(auditFile: string): void {
    try {
      const max = auditMaxBytes()
      const size = fs.statSync(auditFile).size
      if (size < max) return
      const backup = `${auditFile}.1`
      fs.rmSync(backup, {force: true})
      if (size >= max * 10) {
        fs.rmSync(auditFile, {force: true})
      } else {
        fs.renameSync(auditFile, backup)
      }
    } catch {
      // Ignore
    }
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

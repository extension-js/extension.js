// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {ChunkProvenance} from './chunk-dependency-provenance'
import {isGeckoBasedBrowser} from './constants'
import * as messages from './messages'
import {
  type AnyModule,
  ensureOptionalModuleLoaded,
  formatInstallHint
} from './optional-deps-resolver'

// The one place the default lives. Flip it here and the CLI flag, the config
// key and the merge defaults follow.
export const ADDON_LINT_DEFAULT = true

// The linter needs a few hundred ms on a small dist. A large bundle can take
// longer, but a build must never hang on a store check, so this is the cap.
export const ADDON_LINT_TIMEOUT_MS = 10_000

// Enough to act on, short enough to keep the receipt readable.
export const ADDON_LINT_MAX_PRINTED = 20

export const ADDON_LINT_PACKAGE = 'addons-linter'

// Our manifest step already prints a better-worded warning for this one, so
// repeating the linter's copy would show the same defect twice.
const DUPLICATED_BY_BUILD_WARNINGS = new Set([
  'MISSING_DATA_COLLECTION_PERMISSIONS'
])

export interface AddonLintFinding {
  code?: string
  message?: string
  description?: string
  file?: string
  line?: number
  column?: number
}

export interface AddonLintOutput {
  errors?: AddonLintFinding[]
  warnings?: AddonLintFinding[]
  notices?: AddonLintFinding[]
}

export type AddonLintLevel = 'error' | 'warning'

export interface AddonLintLine {
  level: AddonLintLevel
  code: string
  message: string
  location: string
}

export type AddonLintResult =
  | {status: 'skipped'; reason: 'disabled' | 'mode' | 'browser'}
  | {status: 'missing'; hint: string | null}
  | {status: 'failed'; debugLine: string}
  | {status: 'linted'; findings: number; lines: string[]}

type LinterModule = {
  createInstance: (options: {
    config: Record<string, unknown>
    runAsBinary: boolean
  }) => {run: (deps?: Record<string, unknown>) => Promise<AddonLintOutput>}
}

export type LoadAddonLinter = (projectPath: string) => Promise<LinterModule>

export interface RunAddonLintInput {
  projectPath: string
  distPath: string
  distDisplay: string
  browser: string
  mode: 'development' | 'production' | 'none'
  enabled?: boolean
  loadLinter?: LoadAddonLinter
  timeoutMs?: number
  // A thunk, so a build that skips the lint never walks the chunk graph.
  chunkProvenance?: () => Map<string, ChunkProvenance>
}

// The hint is per project rather than per build so `--browser all` and a
// library host looping over targets read it once, not once per target.
const hintedProjects = new Set<string>()

function toModule(loaded: AnyModule): LinterModule {
  const candidate = loaded?.createInstance ? loaded : loaded?.default

  if (typeof candidate?.createInstance !== 'function') {
    throw new Error(`${ADDON_LINT_PACKAGE} exports no createInstance`)
  }

  return candidate as LinterModule
}

const defaultLoadLinter: LoadAddonLinter = (projectPath) =>
  ensureOptionalModuleLoaded<LinterModule>({
    integration: 'AMO',
    projectPath,
    dependencyId: ADDON_LINT_PACKAGE,
    moduleAdapter: toModule
  })

export function shouldRunAddonLint(input: {
  browser: string
  mode: RunAddonLintInput['mode']
  enabled?: boolean
}): Extract<AddonLintResult, {status: 'skipped'}> | null {
  if ((input.enabled ?? ADDON_LINT_DEFAULT) === false) {
    return {status: 'skipped', reason: 'disabled'}
  }

  // Store rules apply to what ships, and a dev artifact carries dev-only
  // grants the linter would flag for nothing.
  if (input.mode !== 'production') {
    return {status: 'skipped', reason: 'mode'}
  }

  if (!isGeckoBasedBrowser(String(input.browser))) {
    return {status: 'skipped', reason: 'browser'}
  }

  return null
}

function locationOf(finding: AddonLintFinding): string {
  const file = String(finding.file || '').trim()
  if (!file) return ''

  const line = typeof finding.line === 'number' ? `:${finding.line}` : ''

  return `${file}${line}`
}

function toLine(level: AddonLintLevel, finding: AddonLintFinding) {
  return {
    level,
    code: String(finding.code || 'UNKNOWN').trim(),
    message: String(finding.message || finding.description || '')
      .replace(/\s+/g, ' ')
      .trim(),
    location: locationOf(finding)
  } satisfies AddonLintLine
}

// Errors first: those are the ones addons.mozilla.org rejects outright.
export function collectAddonLintLines(
  output: AddonLintOutput | null | undefined
): AddonLintLine[] {
  const errors = Array.isArray(output?.errors) ? output.errors : []
  const warnings = Array.isArray(output?.warnings) ? output.warnings : []

  return [
    ...errors.map((finding) => toLine('error', finding)),
    ...warnings.map((finding) => toLine('warning', finding))
  ].filter((line) => !DUPLICATED_BY_BUILD_WARNINGS.has(line.code))
}

// The linter locates a finding by its path inside dist, which is the emitted
// chunk name the provenance map is keyed by.
export function attributionFor(
  location: string,
  chunkProvenance?: Map<string, ChunkProvenance>
): string {
  if (!chunkProvenance || chunkProvenance.size === 0) return ''

  // The map is keyed by the bundler's chunk names, which are always POSIX,
  // while a Windows linter run reports the same file back separated by \.
  const file = location
    .split(':')[0]
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
  const provenance = chunkProvenance.get(file)

  if (!provenance) return ''

  return messages.addonLintDependencyAttribution(
    provenance.packages,
    provenance.onlyDependencies
  )
}

export function formatAddonLintFindings(
  output: AddonLintOutput | null | undefined,
  distDisplay: string,
  maxPrinted: number = ADDON_LINT_MAX_PRINTED,
  chunkProvenance?: Map<string, ChunkProvenance>
): {findings: number; lines: string[]} {
  const all = collectAddonLintLines(output)
  if (all.length === 0) return {findings: 0, lines: []}

  const errorCount = all.filter((line) => line.level === 'error').length
  const warningCount = all.length - errorCount
  const shown = all.slice(0, Math.max(0, maxPrinted))
  const lines = [
    messages.addonLintSummary(errorCount, warningCount, distDisplay),
    ...shown.map((line) =>
      messages.addonLintFinding(
        line.level,
        line.code,
        line.message,
        line.location,
        attributionFor(line.location, chunkProvenance)
      )
    )
  ]

  if (all.length > shown.length) {
    lines.push(messages.addonLintMore(all.length - shown.length, distDisplay))
  }

  return {findings: all.length, lines}
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${Math.round(ms / 1000)} s`))
    }, ms)
    // A late linter must not keep a finished build process alive.
    timer.unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function silentConsole() {
  return {log() {}, error() {}, warn() {}, info() {}}
}

export async function runAddonLint(
  input: RunAddonLintInput
): Promise<AddonLintResult> {
  const skipped = shouldRunAddonLint(input)
  if (skipped) return skipped

  let linter: LinterModule

  try {
    linter = await (input.loadLinter || defaultLoadLinter)(input.projectPath)
  } catch {
    if (hintedProjects.has(input.projectPath)) {
      return {status: 'missing', hint: null}
    }

    hintedProjects.add(input.projectPath)

    return {
      status: 'missing',
      hint: messages.addonLintNotInstalled(
        formatInstallHint(input.projectPath, [ADDON_LINT_PACKAGE])
      )
    }
  }

  try {
    const instance = linter.createInstance({
      config: {
        _: [input.distPath],
        logLevel: 'fatal',
        stack: false,
        pretty: false,
        boring: true,
        warningsAsErrors: false,
        metadata: false,
        output: 'none',
        selfHosted: false,
        // Source maps are not part of what AMO reviews.
        shouldScanFile: (fileName: string) => !/\.map$/i.test(fileName)
      },
      // Never let the linter call process.exit on the build.
      runAsBinary: false
    })
    const output = await withTimeout(
      instance.run({_console: silentConsole()}),
      input.timeoutMs ?? ADDON_LINT_TIMEOUT_MS
    )

    return {
      status: 'linted',
      ...formatAddonLintFindings(
        output,
        input.distDisplay,
        ADDON_LINT_MAX_PRINTED,
        input.chunkProvenance?.()
      )
    }
  } catch (error) {
    return {
      status: 'failed',
      debugLine: messages.addonLintFailed(
        String((error as Error)?.message || error)
      )
    }
  }
}

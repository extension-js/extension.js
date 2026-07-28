import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {CODES} from '../../helpers/messaging'

const here = path.dirname(fileURLToPath(import.meta.url))

const schema = JSON.parse(
  fs.readFileSync(path.join(here, 'envelope.schema.json'), 'utf8')
)

interface CodeEntry {
  area: string
  summary: string
  warn?: boolean
}

interface CodesTable {
  schema: number
  codes: Record<string, CodeEntry>
  legacy: {
    ready: Record<string, string | string[]>
    names: Record<string, string | string[]>
    doctorChecks: Record<string, string>
  }
  folded: Record<string, string>
}

const table: CodesTable = JSON.parse(
  fs.readFileSync(path.join(here, 'codes.json'), 'utf8')
)

// The full id set of each pre-envelope convention, pinned here so a new
// legacy id cannot appear in the tree without a row in codes.json.
const READY_CODES = [
  'browser_exited',
  'compile_error',
  'compile_failed',
  'dev_server_start_failed',
  'extension_load_refused',
  'preview_manifest_missing',
  'profile_locked',
  'shutdown'
]

const ERROR_NAMES = [
  'AmbiguousInstanceError',
  'BadRequest',
  'CliError',
  'EvalDisabled',
  'EvalError',
  'EvalTokenMismatch',
  'EvalTokenMissing',
  'Forbidden',
  'InspectError',
  'StorageError',
  'TargetNotFound',
  'TemplateDownloadError',
  'TemplateNotFoundError',
  'Timeout',
  'Unavailable',
  'Unsupported'
]

const DOCTOR_CHECKS = [
  'browser',
  'control-channel',
  'eval-token',
  'executor',
  'port-agreement',
  'ready-contract',
  'server-process'
]

const flat = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value]

// The same validation the schema states, hand-rolled so the spec has no
// dependency on a JSON Schema runtime.
function validateEnvelope(frame: Record<string, unknown>): string[] {
  const problems: string[] = []

  for (const key of schema.required as string[]) {
    if (!(key in frame)) problems.push(`missing required key: ${key}`)
  }
  if (frame.schema !== 1) problems.push('schema must be 1')
  if (typeof frame.ok !== 'boolean') problems.push('ok must be a boolean')
  if (typeof frame.command !== 'string' || !frame.command)
    problems.push('command must be a non-empty string')
  if (typeof frame.status !== 'string' || !frame.status)
    problems.push('status must be a non-empty string')
  if (
    !Array.isArray(frame.warnings) ||
    frame.warnings.some((w) => typeof w !== 'string')
  )
    problems.push('warnings must be an array of strings')
  if ('truncated' in frame && typeof frame.truncated !== 'boolean')
    problems.push('truncated must be a boolean')
  if ('hint' in frame && typeof frame.hint !== 'string')
    problems.push('hint must be a string')

  const error = frame.error as Record<string, unknown> | null | undefined
  if (error != null) {
    if (!/^E_[A-Z0-9_]+$/.test(String(error.code)))
      problems.push(`error.code is not an E_ identifier: ${error.code}`)
    if (typeof error.message !== 'string')
      problems.push('error.message must be a string')
    for (const key of ['name', 'engine', 'hint']) {
      if (key in error && typeof error[key] !== 'string')
        problems.push(`error.${key} must be a string`)
    }
  }

  if (frame.ok === true && frame.error !== null)
    problems.push('an ok frame must carry error: null')
  if (frame.ok === false && error == null)
    problems.push('a failure frame must carry an error object')

  return problems
}

describe('the error-code table', () => {
  it('mirrors the CODES union in messaging.ts exactly', () => {
    expect(Object.keys(table.codes).sort()).toEqual(Object.values(CODES).sort())
  })

  it('documents every code with a non-empty area and summary', () => {
    for (const [code, entry] of Object.entries(table.codes)) {
      expect(entry.area, `${code} has no area`).toBeTruthy()
      expect(entry.summary, `${code} has no summary`).toBeTruthy()
      if ('warn' in entry) expect(entry.warn).toBe(true)
    }
  })

  it('maps every legacy ready.json code onto the table', () => {
    expect(Object.keys(table.legacy.ready).sort()).toEqual(READY_CODES)
    for (const target of Object.values(table.legacy.ready)) {
      for (const code of flat(target)) {
        expect(
          table.codes,
          `ready maps to unknown code ${code}`
        ).toHaveProperty(code)
      }
    }
  })

  it('maps every legacy PascalCase error name onto the table', () => {
    expect(Object.keys(table.legacy.names).sort()).toEqual(ERROR_NAMES)
    for (const target of Object.values(table.legacy.names)) {
      for (const code of flat(target)) {
        expect(table.codes, `name maps to unknown code ${code}`).toHaveProperty(
          code
        )
      }
    }
  })

  it('maps every kebab-case doctor check id onto the table', () => {
    expect(Object.keys(table.legacy.doctorChecks).sort()).toEqual(DOCTOR_CHECKS)
    for (const code of Object.values(table.legacy.doctorChecks)) {
      expect(
        table.codes,
        `doctor check maps to unknown code ${code}`
      ).toHaveProperty(code)
    }
  })

  it('folds finer names onto real codes without shadowing one', () => {
    for (const [alias, code] of Object.entries(table.folded)) {
      expect(
        table.codes,
        `${alias} folds onto unknown code ${code}`
      ).toHaveProperty(code)
      // An alias in the table proper would make the fold ambiguous.
      expect(alias in table.codes, `${alias} is both a code and a fold`).toBe(
        false
      )
      expect(alias).toMatch(/^E_[A-Z0-9_]+$/)
    }
  })
})

describe('the golden envelope fixtures', () => {
  const fixtures = fs
    .readdirSync(here)
    .filter((name) => name.startsWith('golden.') && name.endsWith('.json'))
    .sort()

  it('collects a non-zero fixture set', () => {
    // Guards the known trap: a glob or include miss silently reporting green
    // over zero files. Every fixture family added later raises this floor.
    expect(fixtures.length).toBeGreaterThanOrEqual(10)
  })

  it('covers success and failure for each representative family', () => {
    expect(fixtures).toContain('golden.build.built.json')
    expect(fixtures).toContain('golden.build.compile.json')
    expect(fixtures).toContain('golden.dev.ready.json')
    expect(fixtures).toContain('golden.dev.first-compile.json')
    expect(fixtures).toContain('golden.doctor.healthy.json')
    expect(fixtures).toContain('golden.doctor.session-not-found.json')
    expect(fixtures).toContain('golden.eval.ok.json')
    expect(fixtures).toContain('golden.eval.eval.json')
    expect(fixtures).toContain('golden.open.headed-window-required.json')
    expect(fixtures).toContain('golden.eval.target-not-found.json')
  })

  it.each(fixtures)('%s validates against envelope.schema.json', (name) => {
    const frame = JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'))
    expect(validateEnvelope(frame)).toEqual([])
  })

  it.each(
    fixtures
  )('%s carries a code from the table when it fails', (name) => {
    const frame = JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'))
    if (frame.error) {
      expect(
        table.codes,
        `${name} uses a code missing from codes.json`
      ).toHaveProperty(frame.error.code)
    }
  })

  it.each(fixtures)('%s is named for its own contents', (name) => {
    const frame = JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'))
    // Success frames slug on status, failure frames on the code tail, so a
    // fixture rename or repurpose fails loudly instead of lying.
    const slug = frame.ok
      ? String(frame.status)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
      : String(frame.error.code)
          .replace(/^E_/, '')
          .toLowerCase()
          .replace(/_/g, '-')
    expect(name).toBe(`golden.${frame.command}.${slug}.json`)
  })
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {DOCTOR_CHECK_CODES, DOCTOR_CHECKS} from '../../commands/doctor'
import {CODES} from '../../helpers/messaging'
import {
  READY_CONTRACT_CODES,
  readyContractErrorCode
} from '../../helpers/ready-contract-codes'

const here = path.dirname(fileURLToPath(import.meta.url))

const schema = JSON.parse(
  fs.readFileSync(path.join(here, 'envelope.schema.json'), 'utf8')
)

interface CodeEntry {
  area: string
  summary: string
  warn?: boolean
  reserved?: boolean
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
  'browser_launch_failed',
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

const flat = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value]

const programsDir = path.resolve(here, '../../..')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '__spec__', '.rslib'])
const SPEC_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/

interface SourceLine {
  file: string
  line: number
  text: string
}

function collectSources(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (SKIPPED_DIRS.has(entry.name)) continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) collectSources(full, found)
    else if (
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !SPEC_FILE.test(entry.name)
    ) {
      found.push(full)
    }
  }

  return found
}

function codeLines(file: string, source: string): SourceLine[] {
  return source
    .split('\n')
    .map((text, index) => ({file, line: index + 1, text}))
    .filter(({text}) => text.includes('E_'))
}

function emitSites(code: string, lines: SourceLine[]): SourceLine[] {
  const named = new RegExp(`\\b${code}\\b`)
  const declaration = new RegExp(`^\\s*${code}: '${code}',?\\s*$`)
  const comment = /^\s*(\/\/|\*|\/\*)/

  return lines.filter(
    ({text}) =>
      named.test(text) && !declaration.test(text) && !comment.test(text)
  )
}

// The same validation the schema states, hand-rolled so the spec has no
// dependency on a JSON Schema runtime.
function validateEnvelope(frame: Record<string, unknown>): string[] {
  const problems: string[] = []

  for (const key of schema.required as string[]) {
    if (!(key in frame)) problems.push(`missing required key: ${key}`)
  }

  if (frame.schema !== 1) problems.push('schema must be 1')
  if (typeof frame.ok !== 'boolean') problems.push('ok must be a boolean')

  if (typeof frame.command !== 'string' || !frame.command) {
    problems.push('command must be a non-empty string')
  }

  if (typeof frame.status !== 'string' || !frame.status) {
    problems.push('status must be a non-empty string')
  }

  if (
    !Array.isArray(frame.warnings) ||
    frame.warnings.some((w) => typeof w !== 'string')
  ) {
    problems.push('warnings must be an array of strings')
  }

  if ('truncated' in frame && typeof frame.truncated !== 'boolean') {
    problems.push('truncated must be a boolean')
  }

  if ('hint' in frame && typeof frame.hint !== 'string') {
    problems.push('hint must be a string')
  }

  const error = frame.error as Record<string, unknown> | null | undefined

  if (error != null) {
    if (!/^E_[A-Z0-9_]+$/.test(String(error.code))) {
      problems.push(`error.code is not an E_ identifier: ${error.code}`)
    }

    if (typeof error.message !== 'string') {
      problems.push('error.message must be a string')
    }

    for (const key of ['name', 'engine', 'hint']) {
      if (key in error && typeof error[key] !== 'string') {
        problems.push(`error.${key} must be a string`)
      }
    }
  }

  if (frame.ok === true && frame.error !== null) {
    problems.push('an ok frame must carry error: null')
  }

  if (frame.ok === false && error == null) {
    problems.push('a failure frame must carry an error object')
  }

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
      if ('reserved' in entry) expect(entry.reserved).toBe(true)
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

  // The runtime map is what a --wait refusal actually carries, so it has to
  // agree with the table a host reads instead of drifting beside it.
  it('resolves every legacy ready.json code the way the table says', () => {
    expect(Object.keys(READY_CONTRACT_CODES).sort()).toEqual(READY_CODES)

    for (const [readyCode, target] of Object.entries(table.legacy.ready)) {
      expect(flat(target), `${readyCode} resolves outside the table`).toContain(
        readyContractErrorCode(readyCode)
      )
    }

    expect(readyContractErrorCode('something_else')).toBeUndefined()
    expect(readyContractErrorCode(undefined)).toBeUndefined()
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

  // The ids come from doctor itself, so a check added without a documented
  // code fails here instead of shipping a contract a host cannot map.
  it('documents exactly the checks doctor emits, with the same codes', () => {
    expect(Object.keys(table.legacy.doctorChecks).sort()).toEqual(
      [...DOCTOR_CHECKS].sort()
    )

    expect(table.legacy.doctorChecks).toEqual(DOCTOR_CHECK_CODES)

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

  // A legacy name has to resolve to a code a consumer can actually receive.
  it('folds no name onto a reserved code', () => {
    const ontoReserved = Object.entries(table.folded)
      .filter(([, code]) => table.codes[code]?.reserved === true)
      .map(([alias, code]) => `${alias} -> ${code}`)

    expect(ontoReserved).toEqual([])
  })

  it.each([
    'E_TSCONFIG_MISSING',
    'E_INTEGRATION_INSTALL',
    'E_WSL_INTEROP',
    'E_MATCH_PATTERN_INVALID'
  ])('keeps %s, retired after it shipped, as a fold and not a code', (retired) => {
    expect(table.codes).not.toHaveProperty(retired)
    expect(table.folded).toHaveProperty(retired)
    expect(CODES).not.toHaveProperty(retired)
  })
})

// The behaviour specs (remote-archive-codes, config-load-failure) prove which
// causes raise these codes, and the summary a reader gets has to name them.
describe('a summary names the causes its code covers', () => {
  it.each([
    ['E_REMOTE_ZIP_INVALID', /not return a ZIP/, /damaged/],
    ['E_REMOTE_ZIP_INVALID', /entry outside its folder/, /damaged/],
    ['E_BROWSER_BINARY_INVALID', /not executable/, /does not exist/],
    ['E_BROWSER_BINARY_INVALID', /version probe/, /within 10 seconds/],
    ['E_REMOTE_DOWNLOAD', /downloaded/, /written/],
    ['E_CONFIG_LOAD', /threw/, /not export an object/],
    ['E_CSP_BLOCKS_EVAL', /extension's own/, /page's own/]
  ])('%s', (code, first, second) => {
    const summary = table.codes[code]?.summary ?? ''

    expect(summary).toMatch(first)
    expect(summary).toMatch(second)
  })

  // An archive that will not unpack is E_REMOTE_ZIP_INVALID now, so the
  // transport code must not claim it.
  it('keeps unpacking out of E_REMOTE_DOWNLOAD', () => {
    expect(table.codes.E_REMOTE_DOWNLOAD?.summary).not.toMatch(
      /extract|unpack|zip/i
    )
  })
})

describe('every declared code is emitted or marked reserved', () => {
  const files = collectSources(programsDir)
  const lines = files.flatMap((file) =>
    codeLines(path.relative(programsDir, file), fs.readFileSync(file, 'utf8'))
  )

  const emitted = new Set<string>(
    Object.values(CODES).filter((code) => emitSites(code, lines).length > 0)
  )

  const reserved = Object.entries(table.codes)
    .filter(([, entry]) => entry.reserved === true)
    .map(([code]) => code)

  it('scans a non-trivial source set', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(emitted.has(CODES.E_ARGS)).toBe(true)
  })

  it('counts a reference in source and nothing else as an emit site', () => {
    const sample = codeLines(
      'sample.ts',
      [
        "  E_SAMPLE: 'E_SAMPLE',",
        '  // E_SAMPLE is only named here',
        '   * E_SAMPLE inside a block comment',
        '  code: CODES.E_SAMPLE_LONGER,',
        '  code: CODES.E_SAMPLE,',
        "  {code: 'E_SAMPLE'}"
      ].join('\n')
    )

    expect(emitSites('E_SAMPLE', sample).map(({line}) => line)).toEqual([5, 6])
  })

  it('marks every code no source can produce as reserved in the table', () => {
    const unmarked = Object.values(CODES).filter(
      (code) => !emitted.has(code) && !reserved.includes(code)
    )

    expect(unmarked).toEqual([])
  })

  it('drops the reserved marker once a code gains an emit site', () => {
    const revived = reserved
      .filter((code) => emitted.has(code))
      .map(
        (code) =>
          `${code} at ${emitSites(code, lines)
            .map(({file, line}) => `${file}:${line}`)
            .join(', ')}`
      )

    expect(revived).toEqual([])
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
    expect(fixtures).toContain('golden.eval.csp-blocks-eval.page.json')
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
    expect(name).toMatch(/^golden\.[a-z]+\.[a-z0-9-]+(\.[a-z0-9-]+)?\.json$/)
    expect(name.split('.').slice(0, 3).join('.')).toBe(
      `golden.${frame.command}.${slug}`
    )
  })
})

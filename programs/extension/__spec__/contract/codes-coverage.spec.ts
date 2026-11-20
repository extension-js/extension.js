import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
// The emit-site scan in codes-table.spec.ts reads every program, since the
// codes develop raises are proven by develop's own specs. So does this one.
const programsDir = path.resolve(here, '../../..')

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.rslib'])
const SPEC_FILE = /\.spec\.[cm]?[jt]sx?$/
// These two read the table itself, so a code they name proves nothing.
const TABLE_SPECS = /codes-(table|coverage)\.spec\.ts$/
// A spec that starts the compiled CLI does it through this helper.
const STARTS_THE_CLI = /from '[./]+\/helpers\/run-cli'/
const COMMENT = /^\s*(\/\/|\*|\/\*)/

interface SpecFile {
  file: string
  startsTheCli: boolean
  // The lines that could assert on a code: comments name one for free.
  lines: string[]
}

interface CodeEntry {
  reserved?: boolean
}

// Codes no spec reads off the compiled CLI yet. Each needs a live browser
// session, an install, a download, a platform or a fault no one command makes.
const IN_PROCESS_ONLY = [
  'E_ACCESSIBILITY_DENIED',
  'E_ADDON_INSTALL',
  'E_ASSET_IMPORT_SHAPE',
  'E_ASSET_MISSING',
  'E_BROWSER_CACHE_NOT_WRITABLE',
  'E_BROWSER_INSTALL_BUSY',
  'E_BROWSER_INSTALL_PRIVILEGE',
  'E_CDP_NOT_CONNECTED',
  'E_CDP_OP_FAILED',
  'E_CDP_TIMEOUT',
  'E_CONTROL_DENIED',
  'E_CONTROL_UNAVAILABLE',
  'E_CSP_BLOCKS_EVAL',
  'E_CSS_PARSE',
  'E_CSS_PREPROCESSOR_MISSING',
  'E_DEPENDENCY_INSTALL',
  'E_DOCTOR_CHECKS_FAILED',
  'E_ENV_FILE_UNREADABLE',
  'E_EVAL',
  'E_EVAL_REFUSED',
  'E_EXTENSION_ID_UNKNOWN',
  'E_FOLDER_UNREADABLE',
  'E_HEADED_WINDOW_REQUIRED',
  'E_INSPECT',
  'E_INSTANCE_AMBIGUOUS',
  'E_INTERNAL',
  'E_JSON_INVALID',
  'E_NODE_VERSION',
  'E_NOT_IMPLEMENTED',
  'E_OPTIONAL_DEP_LOAD',
  'E_OPTIONAL_DEP_UNKNOWN',
  'E_OPTIONAL_DEP_UNRESOLVED',
  'E_OUTPUT_NOT_WRITABLE',
  'E_PERF_BUDGET',
  'E_PORT_UNAVAILABLE',
  'E_PROJECT_DOWNLOAD_EMPTY',
  'E_PROJECT_LAYOUT',
  'E_RESERVED_FOLDER',
  'E_RESTART_REQUIRED',
  'E_SAFARI_TOOLCHAIN',
  'E_SAFARI_UI',
  'E_SCRIPT_DEP_MISSING',
  'E_SHUTDOWN_TIMEOUT',
  'E_STORAGE',
  'E_TARGET_NOT_FOUND',
  'E_TEMPLATE_NOT_FOUND',
  'E_TIMEOUT',
  'E_TOKEN_MISSING',
  'E_USER_GESTURE_REQUIRED',
  'W_API_UNSUPPORTED',
  'W_ASSET_MISSING',
  'W_BROWSER_CONNECTION_CLOSED',
  'W_BUILD_CONSTANT_UNDEFINED',
  'W_CDP_NOT_CONNECTED',
  'W_CDP_OP_FAILED',
  'W_CDP_TIMEOUT',
  'W_CSS_PREPROCESSOR_MISSING',
  'W_ENTRY_NOT_FOUND',
  'W_ENV_DEFINE_WRITTEN',
  'W_ENV_NAME_RESERVED',
  'W_ENV_SECRET_PUBLIC',
  'W_EXTENSION_ID_UNKNOWN',
  'W_HTML_NOT_UTF8',
  'W_INTERNAL',
  'W_JSON_INVALID',
  'W_LAUNCH_SKIPPED_COMPILE_ERRORS',
  'W_LOGS_STREAM_GAP',
  'W_MANIFEST_COMPAT',
  'W_MANIFEST_INVALID',
  'W_NO_ENTRYPOINTS',
  'W_PERF_BUDGET',
  'W_PERMISSION_MISMATCH',
  'W_POLYFILL_NOT_FOUND',
  'W_PORT_IN_USE',
  'W_PROJECT_LAYOUT',
  'W_RESERVED_FOLDER',
  'W_RESTART_REQUIRED',
  'W_SCRIPT_WORLD_UNKNOWN',
  'W_STORE_READINESS',
  'W_TYPES_EMIT',
  'W_WAR_EXPOSURE',
  'W_WAR_INVALID'
]

const table = JSON.parse(
  fs.readFileSync(path.join(here, 'codes.json'), 'utf8')
) as {codes: Record<string, CodeEntry>}

function collectSpecs(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (SKIPPED_DIRS.has(entry.name)) continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) collectSpecs(full, found)
    else if (SPEC_FILE.test(entry.name) && !TABLE_SPECS.test(entry.name)) {
      found.push(full)
    }
  }

  return found
}

function readSpec(file: string, source: string): SpecFile {
  return {
    file,
    startsTheCli: STARTS_THE_CLI.test(source),
    lines: source
      .split('\n')
      .filter((line) => /\b[EW]_[A-Z]/.test(line) && !COMMENT.test(line))
  }
}

interface Coverage {
  throughTheCli: string[]
  inProcessOnly: string[]
  unnamed: string[]
}

function coverageOf(codes: string[], specs: SpecFile[]): Coverage {
  const coverage: Coverage = {throughTheCli: [], inProcessOnly: [], unnamed: []}

  for (const code of codes) {
    const named = new RegExp(`\\b${code}\\b`)
    const naming = specs.filter((spec) =>
      spec.lines.some((line) => named.test(line))
    )

    if (naming.some((spec) => spec.startsTheCli)) {
      coverage.throughTheCli.push(code)
    } else if (naming.length > 0) coverage.inProcessOnly.push(code)
    else coverage.unnamed.push(code)
  }

  return coverage
}

describe('every code a consumer can receive is named by a spec', () => {
  const specs = collectSpecs(programsDir).map((file) =>
    readSpec(path.relative(programsDir, file), fs.readFileSync(file, 'utf8'))
  )
  // A reserved code is on no wire, so no spec can produce it.
  const receivable = Object.entries(table.codes)
    .filter(([, entry]) => entry.reserved !== true)
    .map(([code]) => code)
  const coverage = coverageOf(receivable, specs)

  it('scans a non-trivial spec set, part of which starts the CLI', () => {
    expect(specs.length).toBeGreaterThan(100)
    expect(specs.filter((spec) => spec.startsTheCli).length).toBeGreaterThan(20)
    expect(receivable.length).toBeGreaterThan(100)
  })

  it('counts a code named on a line of a spec, and not in a comment or inside a longer name', () => {
    const sample = [
      readSpec(
        'exec/sample.contract.spec.ts',
        [
          "import {runCli} from '../helpers/run-cli'",
          "expect(frame.error.code).toBe('E_SPAWNED')",
          '// E_COMMENTED is only talked about',
          "expect(frame.error.code).toBe('E_LONGER_NAME')"
        ].join('\n')
      ),
      readSpec(
        'lib/sample.spec.ts',
        "expect(error.code).toBe('E_IN_PROCESS')\nexpect(code).toBe('E_SPAWNED')"
      )
    ]

    expect(
      coverageOf(
        ['E_SPAWNED', 'E_IN_PROCESS', 'E_COMMENTED', 'E_LONGER', 'E_ABSENT'],
        sample
      )
    ).toEqual({
      throughTheCli: ['E_SPAWNED'],
      inProcessOnly: ['E_IN_PROCESS'],
      unnamed: ['E_COMMENTED', 'E_LONGER', 'E_ABSENT']
    })
  })

  // A code no spec names can change meaning, or stop being raised, unseen.
  it('leaves no code in codes.json without a spec that names it', () => {
    expect(coverage.unnamed).toEqual([])
  })

  it('reads the codes not on the compiled CLI as exactly the known list', () => {
    const {throughTheCli, inProcessOnly} = coverage

    console.log(
      [
        `Codes a spec reads off the compiled CLI (${throughTheCli.length}):`,
        throughTheCli.join(' '),
        `Codes only an in-process spec names (${inProcessOnly.length}):`,
        inProcessOnly.join(' ')
      ].join('\n')
    )

    // The exact list, so a code whose last compiled-CLI spec goes away fails
    // here, and one that gains a spec has to leave the list on purpose.
    expect([...inProcessOnly].sort()).toEqual(IN_PROCESS_ONLY)
  })
})

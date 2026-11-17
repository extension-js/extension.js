import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {registerTelemetryCommand} from '../commands/telemetry'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

type TelemetryDeps = NonNullable<Parameters<typeof registerTelemetryCommand>[1]>
type Consent = ReturnType<NonNullable<TelemetryDeps['getConsent']>>
type WriteResult = ReturnType<NonNullable<TelemetryDeps['setConsent']>>

const WRITTEN: WriteResult = {ok: true, path: '/tmp/consent.json'}
const NOT_WRITTEN: WriteResult = {ok: false, path: '/tmp/consent.json'}
const ENABLED_BY_DEFAULT = {enabled: true, source: 'default'} as Consent

// The real pair reads and writes the consent file in the user's config folder.
let consent = ENABLED_BY_DEFAULT
let writeResult = WRITTEN
let writes: string[]
let stdout: string[]
let stderr: string[]

beforeEach(() => {
  writes = []
  stdout = []
  stderr = []
  stubProcessExit()
  vi.spyOn(console, 'log').mockImplementation((line) => {
    stdout.push(String(line))
  })

  vi.spyOn(console, 'error').mockImplementation((line) => {
    stderr.push(String(line))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  consent = ENABLED_BY_DEFAULT
  writeResult = WRITTEN
})

function run(argv: string[]) {
  return runCli(
    makeProgram((program) =>
      registerTelemetryCommand(program, {
        getConsent: () => consent,
        setConsent: (value) => {
          writes.push(value)

          return writeResult
        }
      })
    ),
    argv
  )
}

interface Row {
  name: string
  argv: string[]
  consent?: Consent
  writeResult?: WriteResult
  exit: number
  writes: string[]
  stdout?: string[]
  stderr?: string[]
  // The single frame `--output json` prints in place of the lines above.
  frame: Record<string, unknown>
}

const CONSENT_NOT_WRITTEN = {
  ok: false,
  status: 'failed',
  value: null,
  error: {
    code: 'E_TELEMETRY_WRITE',
    message: 'Could not write telemetry consent file.'
  },
  hint: 'Check write permissions on the consent file path.'
}

const ROWS: Row[] = [
  {
    name: 'enable writes the consent and names the file',
    argv: ['enable'],
    exit: 0,
    writes: ['enabled'],
    stdout: ['✓ Telemetry enabled (/tmp/consent.json).'],
    frame: {
      ok: true,
      status: 'status',
      value: {enabled: true, source: 'config', path: '/tmp/consent.json'},
      error: null
    }
  },
  {
    name: 'disable writes the refusal and names the file',
    argv: ['disable'],
    exit: 0,
    writes: ['disabled'],
    stdout: ['✓ Telemetry disabled (/tmp/consent.json).'],
    frame: {
      ok: true,
      status: 'status',
      value: {enabled: false, source: 'config', path: '/tmp/consent.json'},
      error: null
    }
  },
  {
    name: 'an action is read without its case or surrounding spaces',
    argv: [' Enable '],
    exit: 0,
    writes: ['enabled'],
    stdout: ['✓ Telemetry enabled (/tmp/consent.json).'],
    frame: {
      ok: true,
      status: 'status',
      value: {enabled: true, source: 'config', path: '/tmp/consent.json'},
      error: null
    }
  },
  {
    name: 'enable names no file when storage has none',
    argv: ['enable'],
    writeResult: {ok: true, path: null},
    exit: 0,
    writes: ['enabled'],
    stdout: ['✓ Telemetry enabled.'],
    frame: {
      ok: true,
      status: 'status',
      value: {enabled: true, source: 'config', path: null},
      error: null
    }
  },
  {
    name: 'enable exits 1 when the consent file cannot be written',
    argv: ['enable'],
    writeResult: NOT_WRITTEN,
    exit: 1,
    writes: ['enabled'],
    stderr: ['✗ Could not write telemetry consent file.'],
    frame: CONSENT_NOT_WRITTEN
  },
  {
    name: 'disable exits 1 when the consent file cannot be written',
    argv: ['disable'],
    writeResult: NOT_WRITTEN,
    exit: 1,
    writes: ['disabled'],
    stderr: ['✗ Could not write telemetry consent file.'],
    frame: CONSENT_NOT_WRITTEN
  },
  {
    name: 'no action reads the status and its source',
    argv: [],
    exit: 0,
    writes: [],
    stdout: ['Telemetry: enabled (source: default)'],
    frame: {
      ok: true,
      status: 'status',
      value: {enabled: true, source: 'default'},
      error: null
    }
  },
  {
    name: 'status reports a refusal and where it came from',
    argv: ['status'],
    consent: {enabled: false, source: 'env'} as Consent,
    exit: 0,
    writes: [],
    stdout: ['Telemetry: disabled (source: env)'],
    frame: {
      ok: true,
      status: 'status',
      value: {enabled: false, source: 'env'},
      error: null
    }
  },
  {
    name: 'an unknown action is refused and writes nothing',
    argv: ['bogus'],
    exit: 1,
    writes: [],
    stderr: [
      'Unknown telemetry action: bogus. Expected: enable | disable | status.'
    ],
    frame: {
      ok: false,
      status: 'usage',
      value: null,
      error: {code: 'E_ARGS', message: 'Unknown telemetry action: bogus.'},
      hint: 'Expected: enable | disable | status.'
    }
  }
]

describe.each(ROWS)('extension telemetry: $name', (row) => {
  beforeEach(() => {
    consent = row.consent ?? ENABLED_BY_DEFAULT
    writeResult = row.writeResult ?? WRITTEN
  })

  it('in pretty mode', async () => {
    expect(await run(['telemetry', ...row.argv])).toBe(row.exit)
    expect(writes).toEqual(row.writes)
    expect(stdout).toEqual(row.stdout ?? [])
    expect(stderr).toEqual(row.stderr ?? [])
  })

  it('as one frame and no prose under --output json', async () => {
    expect(await run(['telemetry', ...row.argv, '--output', 'json'])).toBe(
      row.exit
    )

    expect(writes).toEqual(row.writes)
    expect(stdout.map((line) => JSON.parse(line))).toEqual([
      {schema: 1, command: 'telemetry', warnings: [], ...row.frame}
    ])

    expect(stderr).toEqual([])
  })
})

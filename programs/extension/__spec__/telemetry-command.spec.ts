import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {registerTelemetryCommand} from '../commands/telemetry'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

type TelemetryDeps = NonNullable<Parameters<typeof registerTelemetryCommand>[1]>
type Status = ReturnType<NonNullable<TelemetryDeps['getStatus']>>
type WriteResult = ReturnType<NonNullable<TelemetryDeps['setConsent']>>
type ResetResult = ReturnType<NonNullable<TelemetryDeps['reset']>>

const WRITTEN: WriteResult = {ok: true, path: '/tmp/consent.json'}
const NOT_WRITTEN: WriteResult = {ok: false, path: '/tmp/consent.json'}
const NOTHING_STORED = {
  anonymousId: null,
  consentFile: null,
  auditFile: null
}
const ENABLED_BY_DEFAULT: Status = {
  enabled: true,
  source: 'default',
  anonymousId: '11111111-2222-4333-8444-555555555555',
  consentFile: '/tmp/telemetry/consent',
  auditFile: '/tmp/telemetry/events.jsonl'
}
const NOTHING_TO_RESET: ResetResult = {
  ok: true,
  removed: [],
  clearedOptOut: false
}

// The real three read, write and delete files in the user's config folder,
// so every run here is handed all three.
let status = ENABLED_BY_DEFAULT
let writeResult = WRITTEN
let resetResult = NOTHING_TO_RESET
let writes: string[]
let resets: number
let stdout: string[]
let stderr: string[]

beforeEach(() => {
  writes = []
  resets = 0
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
  status = ENABLED_BY_DEFAULT
  writeResult = WRITTEN
  resetResult = NOTHING_TO_RESET
})

function run(argv: string[]) {
  return runCli(
    makeProgram((program) =>
      registerTelemetryCommand(program, {
        getStatus: () => status,
        setConsent: (value) => {
          writes.push(value)

          return writeResult
        },
        reset: () => {
          resets += 1

          return resetResult
        }
      })
    ),
    argv
  )
}

interface Row {
  name: string
  argv: string[]
  status?: Status
  writeResult?: WriteResult
  resetResult?: ResetResult
  exit: number
  writes: string[]
  resets?: number
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
    stderr: [
      '⏵⏵⏵ Error: Could not write telemetry consent file.\n' +
        'PATH /tmp/consent.json\n' +
        'Check write permissions on the consent file path.'
    ],
    frame: CONSENT_NOT_WRITTEN
  },
  {
    name: 'disable exits 1 when the consent file cannot be written',
    argv: ['disable'],
    writeResult: NOT_WRITTEN,
    exit: 1,
    writes: ['disabled'],
    stderr: [
      '⏵⏵⏵ Error: Could not write telemetry consent file.\n' +
        'PATH /tmp/consent.json\n' +
        'Check write permissions on the consent file path.'
    ],
    frame: CONSENT_NOT_WRITTEN
  },
  {
    name: 'no action reads the status, the ID and where the files are',
    argv: [],
    exit: 0,
    writes: [],
    stdout: [
      [
        'Telemetry: enabled (source: default)',
        'Anonymous ID: 11111111-2222-4333-8444-555555555555',
        'Consent file: /tmp/telemetry/consent',
        'Audit log: /tmp/telemetry/events.jsonl'
      ].join('\n')
    ],
    frame: {
      ok: true,
      status: 'status',
      value: {
        enabled: true,
        source: 'default',
        anonymousId: '11111111-2222-4333-8444-555555555555',
        consentFile: '/tmp/telemetry/consent',
        auditFile: '/tmp/telemetry/events.jsonl'
      },
      error: null
    }
  },
  ...(
    [
      'EXTENSION_TELEMETRY_DISABLED',
      'EXTENSION_TELEMETRY',
      'DO_NOT_TRACK'
    ] as const
  ).map(
    (variable): Row => ({
      name: `status names ${variable} as the variable that turned it off`,
      argv: ['status'],
      status: {
        enabled: false,
        source: 'env',
        variable,
        ...NOTHING_STORED
      },
      exit: 0,
      writes: [],
      stdout: [
        [
          `Telemetry: disabled (source: env, ${variable})`,
          'Anonymous ID: none',
          'Consent file: none',
          'Audit log: none'
        ].join('\n')
      ],
      frame: {
        ok: true,
        status: 'status',
        value: {enabled: false, source: 'env', variable, ...NOTHING_STORED},
        error: null
      }
    })
  ),
  {
    name: 'reset says what it removed and that the notice returns',
    argv: ['reset'],
    resetResult: {
      ok: true,
      removed: ['/tmp/telemetry/anonymous-id', '/tmp/telemetry/consent'],
      clearedOptOut: false
    },
    exit: 0,
    writes: [],
    resets: 1,
    stdout: [
      '✓ Telemetry reset. Removed the anonymous ID, the consent and the local audit log. The next run starts fresh and shows the first-run notice.'
    ],
    frame: {
      ok: true,
      status: 'reset',
      value: {
        removed: ['/tmp/telemetry/anonymous-id', '/tmp/telemetry/consent'],
        clearedOptOut: false
      },
      error: null
    }
  },
  {
    name: 'reset warns when it removed a stored opt-out',
    argv: ['reset'],
    resetResult: {
      ok: true,
      removed: ['/tmp/telemetry/consent'],
      clearedOptOut: true
    },
    exit: 0,
    writes: [],
    resets: 1,
    stdout: [
      [
        '✓ Telemetry reset. Removed the anonymous ID, the consent and the local audit log. The next run starts fresh and shows the first-run notice.',
        'A stored opt-out was removed too. Run extension telemetry disable to keep telemetry off.'
      ].join('\n')
    ],
    frame: {
      ok: true,
      status: 'reset',
      value: {removed: ['/tmp/telemetry/consent'], clearedOptOut: true},
      error: null
    }
  },
  {
    name: 'reset with nothing stored says so',
    argv: ['reset'],
    exit: 0,
    writes: [],
    resets: 1,
    stdout: ['✓ Telemetry reset. Nothing was stored.'],
    frame: {
      ok: true,
      status: 'reset',
      value: {removed: [], clearedOptOut: false},
      error: null
    }
  },
  {
    name: 'reset exits 1 when a file could not be removed',
    argv: ['reset'],
    resetResult: {
      ok: false,
      removed: ['/tmp/telemetry/consent'],
      clearedOptOut: false
    },
    exit: 1,
    writes: [],
    resets: 1,
    stderr: [
      '⏵⏵⏵ Error: Could not remove every telemetry file.\n' +
        'Check write permissions on the telemetry folder.'
    ],
    frame: {
      ok: false,
      status: 'failed',
      value: {removed: ['/tmp/telemetry/consent'], clearedOptOut: false},
      error: {
        code: 'E_TELEMETRY_WRITE',
        message: 'Could not remove every telemetry file.'
      },
      hint: 'Check write permissions on the telemetry folder.'
    }
  },
  {
    name: 'an unknown action is refused and writes nothing',
    argv: ['bogus'],
    exit: 1,
    writes: [],
    stderr: [
      '⏵⏵⏵ Error: Unknown telemetry action: bogus.\n' +
        'Expected: enable | disable | status | reset.'
    ],
    frame: {
      ok: false,
      status: 'usage',
      value: null,
      error: {code: 'E_ARGS', message: 'Unknown telemetry action: bogus.'},
      hint: 'Expected: enable | disable | status | reset.'
    }
  }
]

describe.each(ROWS)('extension telemetry: $name', (row) => {
  beforeEach(() => {
    status = row.status ?? ENABLED_BY_DEFAULT
    writeResult = row.writeResult ?? WRITTEN
    resetResult = row.resetResult ?? NOTHING_TO_RESET
  })

  it('in pretty mode', async () => {
    expect(await run(['telemetry', ...row.argv])).toBe(row.exit)
    expect(writes).toEqual(row.writes)
    expect(resets).toBe(row.resets ?? 0)
    expect(stdout).toEqual(row.stdout ?? [])
    expect(stderr).toEqual(row.stderr ?? [])
  })

  it('as one frame and no prose under --output json', async () => {
    expect(await run(['telemetry', ...row.argv, '--output', 'json'])).toBe(
      row.exit
    )

    expect(writes).toEqual(row.writes)
    expect(resets).toBe(row.resets ?? 0)
    expect(stdout.map((line) => JSON.parse(line))).toEqual([
      {schema: 1, command: 'telemetry', warnings: [], ...row.frame}
    ])

    expect(stderr).toEqual([])
  })
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {buildActEnvelope} from '../../commands/act'
import {CODES} from '../../helpers/messaging'

const here = path.dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(
  fs.readFileSync(path.join(here, 'envelope.schema.json'), 'utf8')
)

// Every path the MCP takes over an act frame, read out of its source rather
// than guessed. Each row is <what it reads> -> <where it reads it>.
// extension-dev/packages/public-extensiondev-mcp/src/...
const MCP_TOP_LEVEL_READS = [
  {key: 'ok', site: 'lib/act.ts:65,92 · lib/bridge-tabs.ts:40,122,178'},
  {key: 'value', site: 'lib/bridge-tabs.ts:43,45,178 · tools/eval.ts:88'},
  {key: 'error', site: 'lib/act.ts:66 · tools/eval.ts:105'},
  {
    key: 'hint',
    site: 'lib/act.ts:75 · lib/bridge-tabs.ts:123 · tools/open.ts:690'
  }
]

const MCP_ERROR_READS = [
  {key: 'message', site: 'lib/act.ts:66-70 · tools/open.ts:667'},
  {key: 'hint', site: 'lib/act.ts:72-74'}
]

// C1 keys: not read programmatically today, but they are on the wire and the
// envelope is only a superset if they survive.
const ACT_FRAME_KEYS = ['ok', 'value', 'truncated', 'error']
const ACT_ERROR_KEYS = ['name', 'message', 'engine']

function problems(frame: Record<string, unknown>): string[] {
  const found: string[] = []

  for (const key of schema.required as string[]) {
    if (!(key in frame)) found.push(`missing required key: ${key}`)
  }
  if (frame.schema !== 1) found.push('schema must be 1')
  if (typeof frame.ok !== 'boolean') found.push('ok must be a boolean')
  if (!frame.command) found.push('command must be a non-empty string')
  if (!frame.status) found.push('status must be a non-empty string')
  if (!Array.isArray(frame.warnings)) found.push('warnings must be an array')

  const error = frame.error as Record<string, unknown> | null
  if (frame.ok === false) {
    if (!error) found.push('a failure frame must carry an error')
    else {
      if (!/^E_[A-Z0-9_]+$/.test(String(error.code)))
        found.push(`error.code is not an E_ identifier: ${error.code}`)
      if (typeof error.message !== 'string')
        found.push('error.message must be a string')
    }
  } else if (error !== null) {
    found.push('a success frame must carry error: null')
  }

  return found
}

// A real bridge failure frame: the shape the broker and the in-page producer
// put on the wire (control-bridge/contracts.ts ResultFrame).
const FAILURE_FIXTURES = [
  {
    name: 'Unavailable',
    result: {
      ok: false,
      error: {
        name: 'Unavailable',
        message:
          'no executor connected: the service worker has not attached yet'
      }
    },
    code: CODES.E_CONTROL_UNAVAILABLE,
    status: 'failed'
  },
  {
    name: 'Timeout',
    result: {ok: false, error: {name: 'Timeout', message: 'command timed out'}},
    code: CODES.E_TIMEOUT,
    status: 'timeout'
  },
  {
    name: 'EvalDisabled',
    result: {
      ok: false,
      error: {
        name: 'EvalDisabled',
        message:
          'eval is disabled for this session: restart the dev session with --allow-eval'
      }
    },
    code: CODES.E_EVAL_REFUSED,
    status: 'denied'
  },
  {
    name: 'EvalTokenMissing',
    result: {
      ok: false,
      error: {
        name: 'EvalTokenMissing',
        message:
          'eval session token missing from the hello: the controller could not read the session token'
      }
    },
    code: CODES.E_TOKEN_MISSING,
    status: 'denied'
  },
  {
    name: 'EvalTokenMismatch',
    result: {
      ok: false,
      error: {
        name: 'EvalTokenMismatch',
        message:
          'eval session token mismatch: the token on disk belongs to another session'
      }
    },
    code: CODES.E_EVAL_REFUSED,
    status: 'denied'
  },
  {
    name: 'Forbidden (legacy collapsed denial, prose never sniffed)',
    result: {
      ok: false,
      error: {
        name: 'Forbidden',
        message:
          'eval session token missing from the hello: the controller could not read the session token'
      }
    },
    code: CODES.E_EVAL_REFUSED,
    status: 'denied'
  },
  {
    name: 'TargetNotFound',
    result: {
      ok: false,
      error: {
        name: 'TargetNotFound',
        message:
          'the expression never executed in tab 12: no injectable frame returned a result (restricted page, or outside host_permissions)',
        engine: 'chromium'
      }
    },
    code: CODES.E_TARGET_NOT_FOUND,
    status: 'not-found'
  },
  {
    name: 'BadRequest',
    result: {
      ok: false,
      error: {name: 'BadRequest', message: 'unknown op: teleport'}
    },
    code: CODES.E_ARGS,
    status: 'usage'
  },
  {
    name: 'Unsupported (no tab resolved)',
    result: {
      ok: false,
      error: {
        name: 'Unsupported',
        message:
          'eval/inspect in context page needs a --tab id, a --url to match, or an active tab'
      }
    },
    code: CODES.E_TARGET_NOT_FOUND,
    status: 'not-found'
  },
  {
    name: 'Unsupported (engine gap)',
    result: {
      ok: false,
      error: {
        name: 'Unsupported',
        message: 'sidePanel not available (engine: firefox)'
      }
    },
    code: CODES.E_NOT_IMPLEMENTED,
    status: 'failed'
  },
  {
    name: 'Unsupported (named: needs a headed window)',
    result: {
      ok: false,
      error: {
        name: 'Unsupported',
        message: 'openPopup: Could not find an active browser window.',
        engine: 'chromium',
        code: 'needs_headed_window'
      }
    },
    code: CODES.E_HEADED_WINDOW_REQUIRED,
    status: 'failed'
  },
  {
    name: 'Unsupported (named: needs a user gesture)',
    result: {
      ok: false,
      error: {
        name: 'Unsupported',
        message:
          'sidePanel.open: sidePanel.open() may only be called in response to a user gesture.',
        engine: 'chromium',
        code: 'needs_user_gesture'
      }
    },
    code: CODES.E_USER_GESTURE_REQUIRED,
    status: 'failed'
  },
  {
    name: 'Unsupported (named: surface not open)',
    result: {
      ok: false,
      error: {
        name: 'Unsupported',
        message:
          "surface 'popup' is not open (open it first: extension open popup)",
        engine: 'chromium',
        code: 'surface_not_open'
      }
    },
    code: CODES.E_TARGET_NOT_FOUND,
    status: 'not-found'
  },
  {
    name: 'Unsupported (named: API unavailable)',
    result: {
      ok: false,
      error: {
        name: 'Unsupported',
        message: 'action.openPopup not available',
        engine: 'firefox',
        code: 'api_unavailable'
      }
    },
    code: CODES.E_NOT_IMPLEMENTED,
    status: 'failed'
  },
  {
    name: 'EvalError',
    result: {
      ok: false,
      error: {
        name: 'EvalError',
        message: 'x is not defined',
        engine: 'chromium'
      }
    },
    code: CODES.E_EVAL,
    status: 'failed'
  },
  {
    name: 'InspectError',
    result: {
      ok: false,
      error: {
        name: 'InspectError',
        message: 'no injectable frame returned a snapshot'
      }
    },
    code: CODES.E_INSPECT,
    status: 'failed'
  },
  {
    name: 'StorageError',
    result: {
      ok: false,
      error: {name: 'StorageError', message: 'storage.sync unavailable'}
    },
    code: CODES.E_STORAGE,
    status: 'failed'
  },
  {
    // E_INTERNAL is the last resort now, not the home of the guest errors.
    name: 'an unmapped class',
    result: {ok: false, error: {name: 'Weird', message: 'something broke'}},
    code: CODES.E_INTERNAL,
    status: 'failed'
  }
]

describe('the act frame as a schema-1 envelope', () => {
  it('runs against a non-empty fixture set', () => {
    // __spec__/contract/ collects zero tests without its own vitest glob, so a
    // count assertion is what proves this file did any work at all.
    expect(FAILURE_FIXTURES.length).toBeGreaterThan(0)
    expect(MCP_TOP_LEVEL_READS.length).toBeGreaterThan(0)
  })

  it('keeps every top-level key the MCP reads on a failure frame', () => {
    const frame = buildActEnvelope('eval', {
      ok: false,
      error: {
        name: 'Forbidden',
        message: 'eval is disabled for this session',
        engine: 'chromium',
        hint: 'restart with --allow-eval'
      },
      hint: 'the session hint'
    } as never)

    for (const {key, site} of MCP_TOP_LEVEL_READS) {
      expect(Object.hasOwn(frame, key), `MCP reads ${key} at ${site}`).toBe(
        true
      )
    }
    for (const {key, site} of MCP_ERROR_READS) {
      expect(
        Object.hasOwn(frame.error as object, key),
        `MCP reads error.${key} at ${site}`
      ).toBe(true)
    }

    // Read verbatim, never rewritten: the MCP translates these strings itself.
    const error = frame.error as Record<string, unknown>
    expect(error.message).toBe('eval is disabled for this session')
    expect(error.hint).toBe('restart with --allow-eval')
    expect(error.name).toBe('Forbidden')
    expect(error.engine).toBe('chromium')
    expect(frame.hint).toBe('the session hint')
    expect(problems(frame)).toEqual([])
  })

  it('keeps every act-frame key, so the envelope is a genuine superset', () => {
    const frame = buildActEnvelope('eval', {
      ok: false,
      truncated: true,
      error: {name: 'EvalError', message: 'boom', engine: 'chromium'}
    })

    for (const key of ACT_FRAME_KEYS) {
      expect(Object.hasOwn(frame, key), `envelope lost act key ${key}`).toBe(
        true
      )
    }
    for (const key of ACT_ERROR_KEYS) {
      expect(
        Object.hasOwn(frame.error as object, key),
        `envelope lost act error key ${key}`
      ).toBe(true)
    }
    expect(frame.truncated).toBe(true)
  })

  it('adds schema, command, status, warnings and a code to a success frame', () => {
    const frame = buildActEnvelope('reload', {ok: true, value: 'done'})

    expect(frame).toMatchObject({
      schema: 1,
      ok: true,
      command: 'reload',
      status: 'ok',
      value: 'done',
      error: null,
      warnings: []
    })
    expect(problems(frame)).toEqual([])
  })

  it('keeps value shapes the MCP destructures', () => {
    // bridge-tabs.ts:43 reads value as an array, :45 as {tabs}, :178 as a
    // string; inspect-gecko.ts:148,288 reads value.frames.
    const asArray = buildActEnvelope('inspect', {
      ok: true,
      value: [{tabId: 7, url: 'https://example.com', title: 'x'}]
    })
    expect(Array.isArray(asArray.value)).toBe(true)

    const asTabs = buildActEnvelope('inspect', {ok: true, value: {tabs: []}})
    expect((asTabs.value as {tabs: unknown[]}).tabs).toEqual([])

    const asString = buildActEnvelope('eval', {
      ok: true,
      value: 'chrome-extension://abc/'
    })
    expect(asString.value).toBe('chrome-extension://abc/')

    const withFrames = buildActEnvelope('eval', {
      ok: true,
      value: {frames: [{closed: []}]}
    })
    expect((withFrames.value as {frames: unknown[]}).frames).toHaveLength(1)
  })

  it('reports a null eval result as null rather than dropping the key', () => {
    // tools/eval.ts:88 branches on value === null || value === undefined and
    // annotates the frame; a missing key would still work, an absent `value`
    // would fail the schema.
    const frame = buildActEnvelope('eval', {ok: true})
    expect(Object.hasOwn(frame, 'value')).toBe(true)
    expect(frame.value).toBeNull()
    expect(problems(frame)).toEqual([])
  })

  it('keeps the top-level console key inspect --with-console merges', () => {
    const frame = buildActEnvelope('inspect', {
      ok: true,
      value: {summary: {}},
      console: [{seq: 2, level: 'warn'}]
    } as never)

    expect(frame.console).toEqual([{seq: 2, level: 'warn'}])
    expect(problems(frame)).toEqual([])
  })

  it('never lets an augmentation key overwrite an envelope key', () => {
    const frame = buildActEnvelope('inspect', {
      ok: true,
      value: 'real',
      schema: 99,
      command: 'spoofed',
      status: 'spoofed',
      warnings: 'not an array'
    } as never)

    expect(frame).toMatchObject({
      schema: 1,
      command: 'inspect',
      status: 'ok',
      warnings: []
    })
    expect(problems(frame)).toEqual([])
  })

  it.each(FAILURE_FIXTURES)('maps the $name bridge error onto a stable code', ({
    result,
    code,
    status
  }) => {
    const frame = buildActEnvelope('eval', result)

    expect((frame.error as {code: string}).code).toBe(code)
    expect(frame.status).toBe(status)
    expect(frame.ok).toBe(false)
    expect(frame.value).toBeNull()
    expect(problems(frame)).toEqual([])
  })

  it('lets a named refusal win over message prose', () => {
    const frame = buildActEnvelope('open', {
      ok: false,
      error: {
        name: 'Unsupported',
        message: "surface 'popup' is not open",
        code: 'api_unavailable'
      }
    })
    expect((frame.error as {code: string}).code).toBe(CODES.E_NOT_IMPLEMENTED)
  })

  it('falls back to the prose mapping when the refusal name is unknown', () => {
    const frame = buildActEnvelope('open', {
      ok: false,
      error: {
        name: 'Unsupported',
        message: "surface 'popup' is not open",
        code: 'some_future_refusal'
      }
    })
    expect((frame.error as {code: string}).code).toBe(CODES.E_TARGET_NOT_FOUND)
  })

  it('survives the JSON round trip the MCP performs on stdout', () => {
    // lib/act.ts:88-93 does JSON.parse(stdout.trim()), so the frame must be one
    // serializable document with no undefined holes.
    const frame = buildActEnvelope('inspect', {
      ok: true,
      value: {summary: {}},
      truncated: true,
      console: []
    } as never)
    const line = JSON.stringify(frame)

    expect(line.includes('\n')).toBe(false)
    expect(JSON.parse(line)).toEqual(frame)
  })
})

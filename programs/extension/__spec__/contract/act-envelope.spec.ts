import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {
  buildActEnvelope,
  cspBlocksEvalHint,
  pickTargetTabUrl
} from '../../commands/act'
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
      if (!/^E_[A-Z0-9_]+$/.test(String(error.code))) {
        found.push(`error.code is not an E_ identifier: ${error.code}`)
      }

      if (typeof error.message !== 'string') {
        found.push('error.message must be a string')
      }
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
    // The engine refused the caller's url: a usage error, never E_INTERNAL.
    name: 'BadRequest (named: url refused)',
    result: {
      ok: false,
      error: {
        name: 'BadRequest',
        message:
          "firefox refuses to open about:newtab from the extension's tabs API (Illegal URL: about:newtab)",
        engine: 'firefox',
        code: 'url_refused'
      }
    },
    code: CODES.E_ARGS,
    status: 'usage'
  },
  {
    name: 'TargetNotFound (named: tab not found)',
    result: {
      ok: false,
      error: {
        name: 'TargetNotFound',
        message: 'Invalid tab ID: 999999',
        engine: 'firefox',
        code: 'tab_not_found'
      }
    },
    code: CODES.E_TARGET_NOT_FOUND,
    status: 'not-found'
  },
  {
    // An older producer still sends an unmatched tab filter as Unsupported.
    name: 'Unsupported (unmatched url filter)',
    result: {
      ok: false,
      error: {
        name: 'Unsupported',
        message: 'no open tab matches url: *nomatch*',
        engine: 'chromium'
      }
    },
    code: CODES.E_TARGET_NOT_FOUND,
    status: 'not-found'
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
    name: 'csp_blocks_eval named by the session',
    result: {
      ok: false,
      error: {
        name: 'Unsupported',
        message:
          "eval is blocked in the extension background by the extension's " +
          'content_security_policy, which allows no unsafe-eval',
        engine: 'firefox',
        code: 'csp_blocks_eval'
      }
    },
    code: CODES.E_CSP_BLOCKS_EVAL,
    status: 'denied'
  },
  {
    name: "Gecko's CSP refusal from a session that does not name it",
    result: {
      ok: false,
      error: {
        name: 'EvalError',
        message: 'call to eval() blocked by CSP',
        engine: 'firefox'
      }
    },
    code: CODES.E_CSP_BLOCKS_EVAL,
    status: 'denied'
  },
  {
    name: "Chromium's CSP refusal from a session that does not name it",
    result: {
      ok: false,
      error: {
        name: 'EvalError',
        message:
          "Refused to evaluate a string of JavaScript because 'unsafe-eval' " +
          'is not an allowed source of script in the following Content ' +
          'Security Policy directive: "script-src \'self\'"',
        engine: 'chromium'
      }
    },
    code: CODES.E_CSP_BLOCKS_EVAL,
    status: 'denied'
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
    name: "a fault of the bridge's own executor",
    result: {
      ok: false,
      error: {name: 'ExecutorError', message: 'something broke'}
    },
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

  it('mints the rule a refused url breaks, since the engine only says "Illegal URL"', () => {
    const frame = buildActEnvelope('navigate', {
      ok: false,
      error: {
        name: 'BadRequest',
        message:
          "firefox refuses to open about:newtab from the extension's tabs API (Illegal URL: about:newtab)",
        engine: 'firefox',
        code: 'url_refused'
      }
    })
    const error = frame.error as {code: string; hint: string}
    expect(error.code).toBe(CODES.E_ARGS)
    expect(error.hint).toContain('about:newtab')
    expect(error.hint).toContain('Only web urls and about:blank open this way')

    const chromium = buildActEnvelope('navigate', {
      ok: false,
      error: {
        name: 'BadRequest',
        message: 'chromium refuses to open javascript:alert(1)',
        engine: 'chromium',
        code: 'url_refused'
      }
    }).error as {hint: string}

    expect(chromium.hint).toContain('eval --context content --tab <id>')
    expect(chromium.hint).not.toContain('about:newtab')
  })

  it('points a missing tab at --list-tabs', () => {
    const frame = buildActEnvelope('reload', {
      ok: false,
      error: {
        name: 'TargetNotFound',
        message: 'No tab with id: 999999.',
        engine: 'chromium',
        code: 'tab_not_found'
      }
    })
    const error = frame.error as {code: string; hint: string}

    expect(error.code).toBe(CODES.E_TARGET_NOT_FOUND)
    expect(frame.status).toBe('not-found')
    expect(error.hint).toContain('extension inspect --list-tabs')
  })

  it('reproduces golden.eval.eval.json from a real guest throw', () => {
    const golden = JSON.parse(
      fs.readFileSync(path.join(here, 'golden.eval.eval.json'), 'utf8')
    )
    const frame = buildActEnvelope('eval', {
      ok: false,
      truncated: true,
      error: {
        name: 'EvalError',
        message: 'ReferenceError: chrom is not defined',
        engine: 'chromium'
      }
    })

    expect(frame).toEqual(golden)
    expect((frame.error as {hint: string}).hint).toBe(
      'The expression threw inside the page. Check the expression itself.'
    )
  })

  it('reproduces golden.eval.csp-blocks-eval.json from a Gecko CSP refusal', () => {
    const golden = JSON.parse(
      fs.readFileSync(
        path.join(here, 'golden.eval.csp-blocks-eval.json'),
        'utf8'
      )
    )
    const frame = buildActEnvelope('eval', {
      ok: false,
      error: {
        name: 'EvalError',
        message: 'call to eval() blocked by CSP',
        engine: 'firefox'
      }
    })

    expect(frame).toEqual(golden)
  })

  it('blames the extension CSP for a blocked eval, never the expression', () => {
    for (const message of [
      'call to eval() blocked by CSP',
      "Refused to evaluate a string of JavaScript because 'unsafe-eval' is not allowed",
      'eval of a string is blocked in the ISOLATED (content) world by the extension CSP'
    ]) {
      const error = buildActEnvelope('eval', {
        ok: false,
        error: {name: 'EvalError', message, engine: 'firefox'}
      }).error as {code: string; hint: string}

      expect(error.code, message).toBe(CODES.E_CSP_BLOCKS_EVAL)
      expect(error.hint).toContain('content_security_policy')
      expect(error.hint).not.toContain('Check the expression')
    }
  })

  it('keeps a real guest throw on E_EVAL even when it mentions a policy field', () => {
    const error = buildActEnvelope('eval', {
      ok: false,
      error: {
        name: 'EvalError',
        message: 'policy is not defined',
        engine: 'firefox'
      }
    }).error as {code: string; hint: string}

    expect(error.code).toBe(CODES.E_EVAL)
    expect(error.hint).toContain('Check the expression')
  })

  it('reproduces golden.eval.target-not-found.json from a refused target', () => {
    const golden = JSON.parse(
      fs.readFileSync(
        path.join(here, 'golden.eval.target-not-found.json'),
        'utf8'
      )
    )
    const frame = buildActEnvelope('eval', {
      ok: false,
      error: {
        name: 'TargetNotFound',
        message:
          'the expression never executed in tab 12: no injectable frame returned a result (restricted page, or outside host_permissions)',
        engine: 'chromium'
      }
    })

    expect(frame).toEqual(golden)
  })

  it('maps an inspect refused target to E_TARGET_NOT_FOUND like eval', () => {
    const frame = buildActEnvelope('inspect', {
      ok: false,
      error: {
        name: 'TargetNotFound',
        message:
          'no injectable frame returned a snapshot for tab 9 (restricted page, or outside host_permissions)',
        engine: 'chromium'
      }
    })
    expect((frame.error as {code: string}).code).toBe(CODES.E_TARGET_NOT_FOUND)
    expect(frame.status).toBe('not-found')
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

describe('a throw inside the evaluated expression, as the bridge really names it', () => {
  it.each([
    ['ReferenceError', 'nope is not defined'],
    ['TypeError', 'x.y is not a function'],
    ['SyntaxError', 'expected expression, got end of script'],
    ['Error', 'boom'],
    ['NotFoundError', 'Node was not found'],
    ['MyDomainError', 'custom class']
  ])('codes a thrown %s as a guest error with the expression hint', (name, message) => {
    const frame = buildActEnvelope('eval', {
      ok: false,
      error: {name, message, engine: 'firefox'}
    })
    const error = frame.error as {code: string; hint: string; name: string}

    expect(error.code).toBe(CODES.E_EVAL)
    expect(error.name).toBe(name)
    expect(error.hint).toContain('Check the expression itself')
    expect(frame.status).toBe('failed')
  })

  it("keeps the bridge's own faults and a nameless frame on E_INTERNAL", () => {
    for (const error of [
      {name: 'ExecutorError', message: 'executeCommand threw'},
      {name: 'TabsError', message: 'tabs.query failed'},
      {message: 'a frame with no name'}
    ]) {
      const frame = buildActEnvelope('eval', {ok: false, error} as never)

      expect((frame.error as {code: string}).code, error.message).toBe(
        CODES.E_INTERNAL
      )
    }
  })

  it('reads an error class as a guest throw for eval alone', () => {
    const frame = buildActEnvelope('storage', {
      ok: false,
      error: {name: 'ReferenceError', message: 'nope is not defined'}
    })

    expect((frame.error as {code: string}).code).toBe(CODES.E_INTERNAL)
  })
})

describe("the bridge's own frame fields", () => {
  it('stay off the envelope while a hint and the console lines keep their place', () => {
    const ok = buildActEnvelope('eval', {
      type: 'result',
      cmdId: 'c-69886-1791219834374-1',
      ok: true,
      value: 'host page',
      console: [],
      hint: 'kept'
    } as never)

    expect(ok).not.toHaveProperty('type')
    expect(ok).not.toHaveProperty('cmdId')
    expect(ok).toMatchObject({value: 'host page', console: [], hint: 'kept'})

    const failed = buildActEnvelope('eval', {
      type: 'result',
      cmdId: 'c-69888-1791219834470-1',
      ok: false,
      error: {name: 'ReferenceError', message: 'nope is not defined'}
    } as never)

    expect(failed).not.toHaveProperty('type')
    expect(failed).not.toHaveProperty('cmdId')
    expect(problems(failed)).toEqual([])
  })
})

describe('the hint of a CSP refusal names who owns the policy', () => {
  const DOCUMENT_HINT = JSON.parse(
    fs.readFileSync(path.join(here, 'golden.eval.csp-blocks-eval.json'), 'utf8')
  ).error.hint as string

  it('reproduces golden.eval.csp-blocks-eval.page.json for a page the site locks down', () => {
    const golden = JSON.parse(
      fs.readFileSync(
        path.join(here, 'golden.eval.csp-blocks-eval.page.json'),
        'utf8'
      )
    )
    const frame = buildActEnvelope('eval', {
      ok: false,
      error: {
        name: 'EvalError',
        message: 'call to eval() blocked by CSP',
        engine: 'firefox',
        hint: cspBlocksEvalHint('page', 'firefox')
      }
    } as never)

    expect(frame).toEqual(golden)
  })

  it("blames the page's policy for a page and offers no eval --context page", () => {
    for (const browser of ['firefox', 'chrome']) {
      const hint = cspBlocksEvalHint('page', browser)

      expect(hint, browser).toContain("page's own Content-Security-Policy")
      expect(hint).toContain("extension's policy is not involved")
      expect(hint).toContain('extension inspect --context page')
      expect(hint).not.toContain('extension eval --context page')
    }
  })

  it('names the debugger route on a Gecko session alone', () => {
    expect(cspBlocksEvalHint('page', 'firefox')).toContain('debugger')
    expect(cspBlocksEvalHint('page', 'zen')).toContain('debugger')
    expect(cspBlocksEvalHint('page', 'chrome')).not.toContain('debugger')
    expect(cspBlocksEvalHint('page', 'edge')).not.toContain('Firefox')
  })

  it('names the content-script world and sends the caller to the page world', () => {
    const hint = cspBlocksEvalHint('content', 'firefox')

    expect(hint).toContain('content-script world')
    expect(hint).toContain('extension eval --context page --tab <id>')
    expect(hint).toContain('extension inspect --context content')
  })

  it('keeps the shipped hint for every extension document', () => {
    for (const context of ['background', 'popup', 'options', 'sidebar']) {
      expect(cspBlocksEvalHint(context, 'firefox'), context).toBe(DOCUMENT_HINT)
    }
  })
})

describe('the tab a page eval names, read off the bridge tab list', () => {
  const tabs = [
    {id: 1, url: 'http://127.0.0.1:8791/csp.html', active: false},
    {id: 2, url: 'moz-extension://uuid/pages/welcome.html', active: true},
    {id: 3, url: 'http://127.0.0.1:8791/index.html', active: false}
  ]

  it('follows --tab, then --url whole, then --url as a substring', () => {
    expect(pickTargetTabUrl(tabs, {tabId: 3})).toBe(tabs[2].url)
    expect(pickTargetTabUrl(tabs, {tabId: 9})).toBeUndefined()
    expect(pickTargetTabUrl(tabs, {url: tabs[0].url})).toBe(tabs[0].url)
    expect(pickTargetTabUrl(tabs, {url: 'index.html'})).toBe(tabs[2].url)
    expect(pickTargetTabUrl(tabs, {url: 'nowhere'})).toBeUndefined()
  })

  it('prefers the whole url over an earlier tab that only contains it', () => {
    const nested = [
      {id: 1, url: 'http://a.test/x?next=http://b.test/', active: false},
      {id: 2, url: 'http://b.test/', active: false}
    ]

    expect(pickTargetTabUrl(nested, {url: 'http://b.test/'})).toBe(
      'http://b.test/'
    )
  })

  it('takes the active tab only when exactly one is active', () => {
    expect(pickTargetTabUrl(tabs, {})).toBe(tabs[1].url)

    expect(
      pickTargetTabUrl(
        [...tabs, {id: 4, url: 'http://c.test/', active: true}],
        {}
      )
    ).toBeUndefined()

    expect(pickTargetTabUrl([{id: 5, active: true}], {})).toBeUndefined()
  })
})

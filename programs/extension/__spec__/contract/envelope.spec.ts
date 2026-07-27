import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {CODES, ENVELOPE, ENVELOPE_SCHEMA} from '../../helpers/messaging'

const here = path.dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(
  fs.readFileSync(path.join(here, 'envelope.schema.json'), 'utf8')
)

// The act frame this envelope must remain a superset of, so the MCP keeps
// working: programs/extension/commands/act.ts and the MCP's lib/act.ts.
const ACT_FRAME_KEYS = ['ok', 'value', 'truncated', 'error']
const ACT_ERROR_KEYS = ['name', 'message', 'engine', 'hint']

function validate(frame: Record<string, unknown>): string[] {
  const problems: string[] = []

  for (const key of schema.required as string[]) {
    if (!(key in frame)) problems.push(`missing required key: ${key}`)
  }
  if (frame.schema !== 1) problems.push('schema must be 1')
  if (typeof frame.ok !== 'boolean') problems.push('ok must be a boolean')
  if (!frame.command) problems.push('command must be a non-empty string')
  if (!frame.status) problems.push('status must be a non-empty string')
  if (!Array.isArray(frame.warnings)) problems.push('warnings must be an array')

  const error = frame.error as Record<string, unknown> | null
  if (error !== null) {
    if (!/^E_[A-Z0-9_]+$/.test(String(error.code)))
      problems.push(`error.code is not an E_ identifier: ${error.code}`)
    if (typeof error.message !== 'string')
      problems.push('error.message must be a string')
  }

  return problems
}

describe('the schema-1 result envelope', () => {
  it('validates a success frame', () => {
    const frame = ENVELOPE.ok('build', 'built', {outputPath: '/tmp/dist'})
    expect(validate(frame as never)).toEqual([])
    expect(frame.ok).toBe(true)
    expect(frame.error).toBeNull()
  })

  it('validates a failure frame', () => {
    const frame = ENVELOPE.fail('dev', 'compile-failed', {
      code: CODES.E_FIRST_COMPILE,
      message: 'The first compile failed, so nothing was loaded.'
    })
    expect(validate(frame as never)).toEqual([])
    expect(frame.ok).toBe(false)
    expect(frame.value).toBeNull()
  })

  it('rejects a frame whose error code is not an E_ identifier', () => {
    const bad = {
      ...ENVELOPE.fail('dev', 'x', {
        code: 'nope' as never,
        message: 'm'
      })
    }
    expect(validate(bad as never)).toContain(
      'error.code is not an E_ identifier: nope'
    )
  })

  it('stays a superset of the act frame the MCP already reads', () => {
    const frame = ENVELOPE.fail(
      'eval',
      'refused',
      {
        code: CODES.E_CONTROL_DENIED,
        message: 'refused',
        name: 'Error',
        engine: 'chromium',
        hint: 'pass --allow-control'
      },
      {truncated: true, hint: 'session hint'}
    )

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
    expect(frame.hint).toBe('session hint')
  })

  it('keeps every declared code a distinct E_ identifier', () => {
    const values = Object.values(CODES)
    expect(new Set(values).size).toBe(values.length)
    for (const code of values) expect(code).toMatch(/^E_[A-Z0-9_]+$/)
  })

  it('pins the schema version so a bump is a deliberate edit', () => {
    expect(ENVELOPE_SCHEMA).toBe(1)
    expect(schema.properties.schema.const).toBe(1)
  })

  it('ships a schema the MCP repo can copy and checksum', () => {
    const bytes = fs.readFileSync(path.join(here, 'envelope.schema.json'))
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(digest).toHaveLength(64)
    // A copy in another repo compares against this file byte for byte, so the
    // schema must never be reformatted casually.
    expect(bytes.toString('utf8').endsWith('}\n')).toBe(true)
  })
})

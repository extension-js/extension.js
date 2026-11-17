import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {Telemetry} from '../telemetry'
import {
  fsWith,
  readRows,
  type Sandbox,
  useTelemetrySandbox
} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

afterEach(() => {
  vi.restoreAllMocks()
})

function makeTelemetry(box: Sandbox): Telemetry {
  return box.telemetry({sampleRate: 1, debounceMs: 0, maxEventsPerRun: 1000})
}

function trackOne(telemetry: Telemetry, n: number) {
  telemetry.track('command_executed', {
    command: `test-${n}`,
    success: true,
    version: '0.0.0'
  })
}

function auditFile(box: Sandbox): string {
  return path.join(box.configDir, 'events.jsonl')
}

describe('the audit log stays bounded', () => {
  it('rotates the audit file at the size cap and bounds total disk usage', () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY_AUDIT_MAX_BYTES: '600'}})
    const telemetry = makeTelemetry(box)

    for (let i = 0; i < 50; i++) trackOne(telemetry, i)

    expect(fs.statSync(auditFile(box)).size).toBeLessThan(600 + 1024)
    expect(fs.statSync(`${auditFile(box)}.1`).size).toBeLessThan(600 + 1024)
    expect(fs.readdirSync(box.configDir).sort()).toEqual([
      'anonymous-id',
      'events.jsonl',
      'events.jsonl.1'
    ])
  })

  it('drops a grossly oversized legacy audit file instead of keeping it as backup', () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY_AUDIT_MAX_BYTES: '600'}})

    fs.mkdirSync(box.configDir, {recursive: true})
    fs.writeFileSync(auditFile(box), 'x'.repeat(600 * 10))
    trackOne(makeTelemetry(box), 0)

    expect(
      readRows(auditFile(box)).map((row) => row.properties.command)
    ).toEqual(['test-0'])

    expect(fs.existsSync(`${auditFile(box)}.1`)).toBe(false)
  })

  it('keeps auditing across rotations without disabling telemetry', () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY_AUDIT_MAX_BYTES: '600'}})
    const telemetry = makeTelemetry(box)

    for (let i = 0; i < 50; i++) trackOne(telemetry, i)

    expect(telemetry.isEnabled).toBe(true)
    expect(readRows(auditFile(box)).at(-1)?.properties.command).toBe('test-49')
  })

  it.each([
    '0',
    '-5',
    'abc',
    ''
  ])('keeps the one megabyte cap when the knob reads %j', (value) => {
    const box = sandbox({env: {EXTENSION_TELEMETRY_AUDIT_MAX_BYTES: value}})
    const telemetry = makeTelemetry(box)

    for (let i = 0; i < 50; i++) trackOne(telemetry, i)

    expect(readRows(auditFile(box))).toHaveLength(50)
    expect(fs.existsSync(`${auditFile(box)}.1`)).toBe(false)
  })

  it('keeps writing when the rotation itself fails', () => {
    const box = sandbox({
      env: {EXTENSION_TELEMETRY_AUDIT_MAX_BYTES: '600'},
      deps: {
        fs: fsWith({
          renameSync: () => {
            throw new Error('EBUSY')
          }
        })
      }
    })
    const telemetry = makeTelemetry(box)

    for (let i = 0; i < 20; i++) trackOne(telemetry, i)

    expect(readRows(auditFile(box))).toHaveLength(20)
    expect(telemetry.isEnabled).toBe(true)
  })
})

describe('an audit line that cannot be written', () => {
  it('stops every later send, the one that failed included', async () => {
    const box = sandbox({
      deps: {
        fs: fsWith({
          appendFileSync: () => {
            throw Object.assign(new Error('ENOSPC'), {code: 'ENOSPC'})
          }
        })
      }
    })
    const telemetry = makeTelemetry(box)

    trackOne(telemetry, 0)
    trackOne(telemetry, 1)
    await telemetry.flush()

    expect(telemetry.isEnabled).toBe(false)
    expect(box.sent).toEqual([])
  })
})

describe('the debug knob', () => {
  it('prints each audited row on stderr when EXTENSION_TELEMETRY_DEBUG=1', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const box = sandbox({env: {EXTENSION_TELEMETRY_DEBUG: '1'}})

    trackOne(makeTelemetry(box), 7)

    expect(error.mock.calls.map((call) => call[0])).toEqual(['[telemetry]'])
    expect(JSON.parse(String(error.mock.calls[0][1])).properties.command).toBe(
      'test-7'
    )
  })

  it.each(['true', '0', ''])('prints nothing when it reads %j', (value) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const box = sandbox({env: {EXTENSION_TELEMETRY_DEBUG: value}})

    trackOne(makeTelemetry(box), 7)

    expect(error).not.toHaveBeenCalled()
  })
})

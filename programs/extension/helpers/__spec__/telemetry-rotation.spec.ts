import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Telemetry} from '../telemetry'

const originalEnv = {...process.env}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value
  }
}

function makeTelemetry() {
  return new Telemetry({
    app: 'extension',
    version: '0.0.0',
    sampleRate: 1,
    debounceMs: 0,
    maxEventsPerRun: 1000
  })
}

function trackOne(telemetry: Telemetry, n: number) {
  telemetry.track('command_executed', {
    command: `test-${n}`,
    success: true,
    version: '0.0.0'
  })
}

let configHome: string

beforeEach(() => {
  configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-rotation-'))
  process.env.XDG_CONFIG_HOME = configHome
  process.env.XDG_CACHE_HOME = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extjs-rotation-cache-')
  )
})

afterEach(() => {
  restoreEnv()
})

it('rotates the audit file at the size cap and bounds total disk usage', () => {
  process.env.EXTENSION_TELEMETRY_AUDIT_MAX_BYTES = '600'

  const telemetry = makeTelemetry()
  for (let i = 0; i < 50; i++) trackOne(telemetry, i)

  const auditFile = path.join(
    configHome,
    'extensionjs',
    'telemetry',
    'events.jsonl'
  )
  const backup = `${auditFile}.1`

  expect(fs.existsSync(auditFile)).toBe(true)
  expect(fs.existsSync(backup)).toBe(true)
  // one event (~300 bytes) may land after the pre-append size check
  expect(fs.statSync(auditFile).size).toBeLessThan(600 + 1024)
  expect(fs.statSync(backup).size).toBeLessThan(600 + 1024)
})

it('drops a grossly oversized legacy audit file instead of keeping it as backup', () => {
  process.env.EXTENSION_TELEMETRY_AUDIT_MAX_BYTES = '600'

  const telemetryDir = path.join(configHome, 'extensionjs', 'telemetry')
  fs.mkdirSync(telemetryDir, {recursive: true})
  const auditFile = path.join(telemetryDir, 'events.jsonl')
  // >= 10x the cap, standing in for the unbounded pre-fix growth
  fs.writeFileSync(auditFile, 'x'.repeat(600 * 10))

  const telemetry = makeTelemetry()
  trackOne(telemetry, 0)

  expect(fs.statSync(auditFile).size).toBeLessThan(1024)
  expect(fs.existsSync(`${auditFile}.1`)).toBe(false)
})

it('keeps auditing across rotations without disabling telemetry', () => {
  process.env.EXTENSION_TELEMETRY_AUDIT_MAX_BYTES = '600'

  const telemetry = makeTelemetry()
  for (let i = 0; i < 50; i++) trackOne(telemetry, i)

  expect(telemetry.isEnabled).toBe(true)

  const auditFile = path.join(
    configHome,
    'extensionjs',
    'telemetry',
    'events.jsonl'
  )
  const last = fs
    .readFileSync(auditFile, 'utf8')
    .trim()
    .split('\n')
    .at(-1) as string
  expect(JSON.parse(last).properties.command).toBe('test-49')
})

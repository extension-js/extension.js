import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Telemetry} from '../telemetry'

const originalEnv = {...process.env}
const originalCwd = process.cwd()

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

function canWrite(dir: string): boolean {
  try {
    fs.mkdirSync(dir, {recursive: true})
    const probe = path.join(dir, `.write-test-${Date.now()}`)
    fs.writeFileSync(probe, 'ok', 'utf8')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

afterEach(() => {
  restoreEnv()
  process.chdir(originalCwd)
})

it('writes audit to cache when config path is unwritable', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-telemetry-'))
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-'))
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cache-'))

  try {
    fs.chmodSync(configHome, 0o500)
  } catch {
    // best-effort on platforms that ignore chmod (e.g. Windows)
  }

  const configWritable = canWrite(configHome)

  process.env.XDG_CONFIG_HOME = configHome
  process.env.XDG_CACHE_HOME = cacheHome
  process.env.EXTENSION_PUBLIC_POSTHOG_KEY = ''
  process.env.EXTENSION_PUBLIC_POSTHOG_HOST = ''
  process.chdir(work)

  const telemetry = new Telemetry({app: 'extension', version: '0.0.0'})
  telemetry.track('test_event')

  const configAudit = path.join(
    configHome,
    'extensionjs',
    'telemetry',
    'events.jsonl'
  )
  const cacheAudit = path.join(
    cacheHome,
    'extensionjs',
    'telemetry',
    'events.jsonl'
  )

  if (!configWritable) {
    expect(fs.existsSync(cacheAudit)).toBe(true)
    expect(fs.existsSync(configAudit)).toBe(false)
  } else {
    expect(fs.existsSync(configAudit) || fs.existsSync(cacheAudit)).toBe(true)
  }
})

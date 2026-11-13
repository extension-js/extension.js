import fs from 'node:fs'
import path from 'node:path'
import {afterEach, expect, it} from 'vitest'
import {Telemetry} from '../telemetry'
import {useTempFolders} from '../../__spec__/helpers/temp-folders'

const makeTempFolder = useTempFolders()

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
  const work = makeTempFolder('extjs-telemetry-')
  const configHome = makeTempFolder('extjs-config-')
  const cacheHome = makeTempFolder('extjs-cache-')

  try {
    fs.chmodSync(configHome, 0o500)
  } catch {
    // Ignore
  }

  const configWritable = canWrite(configHome)

  process.env.XDG_CONFIG_HOME = configHome
  process.env.XDG_CACHE_HOME = cacheHome
  process.chdir(work)

  const telemetry = new Telemetry({
    app: 'extension',
    version: '0.0.0',
    sampleRate: 1,
    debounceMs: 0
  })
  telemetry.track('command_executed', {
    command: 'test',
    success: true,
    version: '0.0.0'
  })

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

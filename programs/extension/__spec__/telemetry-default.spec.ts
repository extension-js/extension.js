import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {expect, it} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()

function cliRoot(): string {
  return path.resolve(__dirname, '..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs

  return path.join(cliRoot(), 'dist', 'cli.js')
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

it('runs successfully even without PostHog keys (local audit allowed)', () => {
  const work = makeTempFolder('extjs-cli-')

  const r = spawnSync(process.execPath, [cliBin(), '--version'], {
    cwd: work,
    env: {
      ...process.env
    },
    stdio: 'ignore'
  })
  expect(r.error).toBeUndefined()
}, 120000)

it('falls back to cache when config path is unwritable', () => {
  const work = makeTempFolder('extjs-cli-')
  const configHome = makeTempFolder('extjs-config-')
  const cacheHome = makeTempFolder('extjs-cache-')

  try {
    fs.chmodSync(configHome, 0o500)
  } catch {
    // Ignore
  }

  const configWritable = canWrite(configHome)

  const r = spawnSync(process.execPath, [cliBin(), '--version'], {
    cwd: work,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: configHome,
      XDG_CACHE_HOME: cacheHome
    },
    stdio: 'ignore'
  })

  expect(r.error).toBeUndefined()
  expect(r.status).toBe(0)
}, 120000)

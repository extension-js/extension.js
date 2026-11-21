import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {resolveConfigBrowser} from '../config-browser'

const makeTempFolder = trackTempFolders()

// The config names its browser from an env value, so the answer says which
// env files the probe read.
function projectWith(envFiles: Record<string, string>): string {
  const dir = makeTempFolder('extjs-config-browser-')

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"probe","type":"module"}'
  )

  fs.writeFileSync(
    path.join(dir, 'extension.config.js'),
    'const browser = process.env.EXTENSION_PUBLIC_PROBE_BROWSER\n' +
      'export default {commands: {dev: {browser}, build: {browser}, start: {browser}}}\n'
  )

  for (const [name, browser] of Object.entries(envFiles)) {
    fs.writeFileSync(
      path.join(dir, name),
      `EXTENSION_PUBLIC_PROBE_BROWSER=${browser}\n`
    )
  }

  return dir
}

// The probe runs before any browser is known, so it is the one config load
// that names none of its own: it reads as the stock browser would.
describe('the probe that finds the browser in the config', () => {
  it('finds a browser the mode env file of the command names', async () => {
    const dir = projectWith({
      '.env.development': 'firefox',
      '.env.production': 'edge'
    })

    await expect(resolveConfigBrowser(dir, 'dev')).resolves.toBe('firefox')
    await expect(resolveConfigBrowser(dir, 'build')).resolves.toBe('edge')
    await expect(resolveConfigBrowser(dir, 'start')).resolves.toBe('edge')
  })

  it('reads the env files of the mode a build was asked for', async () => {
    const dir = projectWith({
      '.env.development': 'firefox',
      '.env.production': 'edge'
    })

    await expect(
      resolveConfigBrowser(dir, 'build', undefined, 'development')
    ).resolves.toBe('firefox')
  })

  it('reads the env files of the stock browser, as the engine does', async () => {
    const dir = projectWith({
      '.env.production': 'edge',
      '.env.chromium': 'firefox'
    })

    await expect(resolveConfigBrowser(dir, 'build')).resolves.toBe('firefox')
  })

  it('answers unset for a config that names no browser', async () => {
    await expect(
      resolveConfigBrowser(projectWith({}), 'dev')
    ).resolves.toBeUndefined()
  })
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {resolveNoBrowser} from '../no-browser'

const makeTempFolder = trackTempFolders()

function projectWith(config: string | null): string {
  const dir = makeTempFolder('extjs-nobrowser-')
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"probe","type":"module"}'
  )

  if (config !== null) {
    fs.writeFileSync(path.join(dir, 'extension.config.js'), config)
  }

  return dir
}

describe('resolveNoBrowser', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads commands.dev.noBrowser from the file config', async () => {
    const dir = projectWith(
      'export default {commands: {dev: {noBrowser: true}}}'
    )
    await expect(resolveNoBrowser(dir, 'dev')).resolves.toBe(true)
  })

  it('stays false without a config or option', async () => {
    await expect(resolveNoBrowser(projectWith(null), 'dev')).resolves.toBe(
      false
    )

    const dir = projectWith('export default {commands: {dev: {}}}')
    await expect(resolveNoBrowser(dir, 'dev')).resolves.toBe(false)
  })

  it('lets the flag win regardless of the file', async () => {
    vi.stubEnv('EXTENSION_CLI_NO_BROWSER', '1')
    const dir = projectWith(
      'export default {commands: {dev: {noBrowser: false}}}'
    )
    await expect(resolveNoBrowser(dir, 'dev')).resolves.toBe(true)
  })

  it('resolves per command key', async () => {
    const dir = projectWith(
      'export default {commands: {start: {noBrowser: true}}}'
    )
    await expect(resolveNoBrowser(dir, 'start')).resolves.toBe(true)
    await expect(resolveNoBrowser(dir, 'dev')).resolves.toBe(false)
  })

  // The engine reads the config under the browser's env files, so the
  // wrapper has to, or the two disagree on whether a browser opens.
  it('reads the config under the env files of the browser the run launches', async () => {
    const dir = projectWith(
      "export default {commands: {dev: {noBrowser: process.env.EXTENSION_PUBLIC_NO_WINDOW === '1'}}}"
    )
    fs.writeFileSync(
      path.join(dir, '.env.firefox'),
      'EXTENSION_PUBLIC_NO_WINDOW=1\n'
    )

    await expect(
      resolveNoBrowser(dir, 'dev', undefined, 'firefox')
    ).resolves.toBe(true)

    await expect(
      resolveNoBrowser(dir, 'dev', undefined, 'chrome')
    ).resolves.toBe(false)
  })
})

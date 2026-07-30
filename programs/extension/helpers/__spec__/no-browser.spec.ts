import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {resolveNoBrowser} from '../no-browser'

function projectWith(config: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-nobrowser-'))
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
    delete process.env.EXTENSION_CLI_NO_BROWSER
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
    process.env.EXTENSION_CLI_NO_BROWSER = '1'
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
})

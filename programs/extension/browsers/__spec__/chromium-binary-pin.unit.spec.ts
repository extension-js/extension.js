import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createChromiumContext} from '../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../run-chromium/chromium-launch'

describe('ChromiumLaunchPlugin --chromium-binary', () => {
  const dirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of dirs.splice(0)) {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  function compilation() {
    return {
      options: {
        mode: 'production',
        context: '/tmp',
        output: {path: '/tmp/ext'}
      },
      errors: []
    } as any
  }

  it('rejects a missing pin on chrome instead of asking to install Chrome for Testing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: ['/tmp/ext'],
        chromiumBinary: '/no/such/canary'
      } as any,
      createChromiumContext() as any
    )

    await expect(plugin.runOnce(compilation())).rejects.toThrow(
      /Invalid --chromium-binary path/
    )
    const printed = error.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).toMatch(/Can't find a Chromium binary at the given path/)
    expect(printed).not.toMatch(/Chrome for Testing/)
    expect(printed).not.toMatch(/npx extension install chrome/)
  })

  it('dry-runs the named pin on chrome, not chromium-mock-binary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'extjs-pin-unit-'))
    dirs.push(dir)
    const pin = join(dir, 'canary')
    writeFileSync(pin, '#!/bin/sh\nexit 0\n')
    chmodSync(pin, 0o755)

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: ['/tmp/ext'],
        chromiumBinary: pin
      } as any,
      createChromiumContext() as any
    )

    await plugin.runOnce(compilation())
    const printed = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).toContain(pin)
    expect(printed).not.toContain('chromium-mock-binary')
  })
})

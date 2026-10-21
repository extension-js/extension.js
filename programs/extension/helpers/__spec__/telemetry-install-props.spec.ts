import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest'
import {Telemetry} from '../telemetry'

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-install-props-'))
const savedConfigHome = process.env.XDG_CONFIG_HOME
process.env.XDG_CONFIG_HOME = sandbox

afterAll(() => {
  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedConfigHome

  fs.rmSync(sandbox, {recursive: true, force: true})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function sentProperties(
  props: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const bodies: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: {body?: string}) => {
      bodies.push(String(init?.body ?? ''))

      return new Response('{"status":1}', {status: 200})
    })
  )

  const telemetry = new Telemetry({app: 'extension', version: '9.9.9'})
  telemetry.track('command_failed', {
    command: 'create',
    success: false,
    version: '9.9.9',
    ...props
  })

  await telemetry.flush()

  const body = JSON.parse(bodies[0]) as {
    batch: Array<{properties: Record<string, unknown>}>
  }

  return body.batch[0].properties
}

describe('install outcomes reach the wire', () => {
  it('sends the browser install outcome the docs list', async () => {
    const properties = await sentProperties({
      browser_install: 'accepted',
      browser_install_browser: 'chrome',
      browser_install_seconds: 42
    })

    expect(properties.browser_install).toBe('accepted')
    expect(properties.browser_install_browser).toBe('chrome')
    expect(properties.browser_install_seconds).toBe(42)
  })

  it('sends the dependency install outcome on create', async () => {
    const properties = await sentProperties({
      deps_install: 'installed',
      deps_install_seconds: 31
    })

    expect(properties.deps_install).toBe('installed')
    expect(properties.deps_install_seconds).toBe(31)
  })

  it('drops any value that is not a fixed word or a bounded whole number', async () => {
    const properties = await sentProperties({
      browser_install: '/Users/someone/project',
      browser_install_browser: 'my-private-build',
      browser_install_seconds: 1.5,
      deps_install: 'npm ERR! code ENOENT',
      deps_install_seconds: -4
    })

    expect(properties).not.toHaveProperty('browser_install')
    expect(properties).not.toHaveProperty('browser_install_browser')
    expect(properties).not.toHaveProperty('browser_install_seconds')
    expect(properties).not.toHaveProperty('deps_install')
    expect(properties).not.toHaveProperty('deps_install_seconds')
  })
})

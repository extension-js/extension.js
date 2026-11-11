import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest'
import {packageManagerName, Telemetry} from '../telemetry'

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-install-props-'))
const savedConfigHome = process.env.XDG_CONFIG_HOME
const savedUserAgent = process.env.npm_config_user_agent
process.env.XDG_CONFIG_HOME = sandbox

afterAll(() => {
  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedConfigHome

  fs.rmSync(sandbox, {recursive: true, force: true})
})

afterEach(() => {
  vi.unstubAllGlobals()

  if (savedUserAgent === undefined) delete process.env.npm_config_user_agent
  else process.env.npm_config_user_agent = savedUserAgent
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

describe('the package manager that ran the command', () => {
  it('reads the name from the head of the user agent', () => {
    const agents: Array<[string, string]> = [
      ['npm/10.8.2 node/v22.11.0 darwin arm64 workspaces/false', 'npm'],
      ['pnpm/10.28.0 npm/? node/v23.8.0 darwin arm64', 'pnpm'],
      ['yarn/1.22.22 npm/? node/v24.0.0 linux x64', 'yarn'],
      ['bun/1.2.4 npm/? node/v22.6.0 darwin arm64', 'bun'],
      ['  PNPM/9.0.0 npm/? node/v20.0.0', 'pnpm']
    ]

    for (const [agent, name] of agents) {
      expect(packageManagerName({npm_config_user_agent: agent})).toBe(name)
    }
  })

  it('answers unknown for a bare binary call and for any other head', () => {
    expect(packageManagerName({})).toBe('unknown')
    expect(packageManagerName({npm_config_user_agent: '   '})).toBe('unknown')
    expect(packageManagerName({npm_config_user_agent: 'deno/2.1.0'})).toBe(
      'unknown'
    )

    expect(
      packageManagerName({npm_config_user_agent: '/Users/someone/project'})
    ).toBe('unknown')
  })

  it('sends the name alone on a failure, never the version or the agent', async () => {
    process.env.npm_config_user_agent =
      'pnpm/10.28.0 npm/? node/v23.8.0 darwin arm64'

    const properties = await sentProperties({})

    expect(properties.package_manager).toBe('pnpm')
    expect(JSON.stringify(properties)).not.toContain('10.28.0')
  })

  it('sends unknown when no package manager started the run', async () => {
    delete process.env.npm_config_user_agent

    const properties = await sentProperties({})

    expect(properties.package_manager).toBe('unknown')
  })
})

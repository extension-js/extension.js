import {describe, expect, it} from 'vitest'
import {packageManagerName, type TelemetryEnv} from '../telemetry'
import {useTelemetrySandbox} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

async function sentProperties(
  props: Record<string, unknown>,
  env: TelemetryEnv = {}
): Promise<Record<string, unknown>> {
  const box = sandbox({env})
  const telemetry = box.telemetry({})

  telemetry.track('command_failed', {
    command: 'create',
    success: false,
    version: '9.9.9',
    ...props
  })

  await telemetry.flush()

  const rows = box.sentRows()
  expect(rows).toHaveLength(1)

  return rows[0].properties
}

describe('install outcomes reach the wire', () => {
  it('sends the browser install outcome the docs list', async () => {
    const properties = await sentProperties({
      browser_install: 'accepted',
      browser_install_browser: 'chrome',
      browser_install_seconds: 42
    })

    expect(properties).toMatchObject({
      browser_install: 'accepted',
      browser_install_browser: 'chrome',
      browser_install_seconds: 42
    })
  })

  it('sends the dependency install outcome on create', async () => {
    const properties = await sentProperties({
      deps_install: 'installed',
      deps_install_seconds: 31
    })

    expect(properties).toMatchObject({
      deps_install: 'installed',
      deps_install_seconds: 31
    })
  })

  it.each([
    ['browser_install', '/Users/someone/project'],
    ['browser_install_browser', 'my-private-build'],
    ['browser_install_seconds', 1.5],
    ['browser_install_seconds', 86_401],
    ['deps_install', 'npm ERR! code ENOENT'],
    ['deps_install_seconds', -4],
    ['deps_install_seconds', '31'],
    ['code', 'ENOENT'],
    ['code', 'E_lowercase'],
    ['code', `E_${'X'.repeat(49)}`],
    ['exit_code', 256],
    ['exit_code', -1],
    ['exit_code', 1.5]
  ])('drops %s=%j, which is not a fixed word or a bounded number', async (key, value) => {
    const properties = await sentProperties({[key]: value})

    expect(properties).not.toHaveProperty(key)
  })

  it.each([
    ['code', 'E_INTERNAL'],
    ['code', `E_${'X'.repeat(48)}`],
    ['exit_code', 0],
    ['exit_code', 255],
    ['browser_install_seconds', 0],
    ['browser_install_seconds', 86_400]
  ])('keeps %s=%j', async (key, value) => {
    expect(await sentProperties({[key]: value})).toHaveProperty(key, value)
  })

  it('cuts the command to 32 characters and strips tags to a safe alphabet', async () => {
    const properties = await sentProperties({
      command: 'c'.repeat(40),
      template: ' my template/../x ',
      source: 'templates?ref=a b'
    })

    expect(properties).toMatchObject({
      command: 'c'.repeat(32),
      template: 'mytemplate..x',
      source: 'templatesrefab'
    })
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
    const properties = await sentProperties(
      {},
      {npm_config_user_agent: 'pnpm/10.28.0 npm/? node/v23.8.0 darwin arm64'}
    )

    expect(properties.package_manager).toBe('pnpm')
    expect(JSON.stringify(properties)).not.toContain('10.28.0')
  })

  it('sends unknown when no package manager started the run', async () => {
    expect((await sentProperties({})).package_manager).toBe('unknown')
  })
})

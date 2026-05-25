import {afterEach, describe, expect, it} from 'vitest'
import {
  browserInstallArgs,
  browserInstallEnv,
  browserInstallCommand,
  isEdgePrivilegeEscalationFailure
} from '../lib/runner'

describe('install runner mapping', () => {
  const prevEnv = {...process.env}

  afterEach(() => {
    process.env = {...prevEnv}
  })

  function clearPackageManagerEnv() {
    delete process.env.npm_config_user_agent
    delete process.env.npm_execpath
    delete process.env.NPM_EXEC_PATH
  }

  it('maps chromium-family browsers to puppeteer installer args', () => {
    clearPackageManagerEnv()

    const chromiumArgs = browserInstallArgs('chromium', '/tmp/x')
    expect(chromiumArgs).toEqual([
      '-y',
      '@puppeteer/browsers@latest',
      'install',
      'chromium',
      '--path',
      '/tmp/x'
    ])

    const chromeArgs = browserInstallArgs('chrome', '/tmp/x')
    expect(chromeArgs).toEqual([
      '-y',
      '@puppeteer/browsers@latest',
      'install',
      'chrome@stable',
      '--path',
      '/tmp/x'
    ])
  })

  it('maps edge to playwright installer args + env', () => {
    clearPackageManagerEnv()

    expect(browserInstallArgs('edge', '/tmp/edge')).toEqual([
      '-y',
      'playwright@latest',
      'install',
      'msedge'
    ])
    expect(
      browserInstallEnv('edge', '/tmp/edge').PLAYWRIGHT_BROWSERS_PATH
    ).toBe('/tmp/edge')
  })

  it('returns package runner command variant by platform', () => {
    clearPackageManagerEnv()

    const cmd = browserInstallCommand('firefox')
    expect(cmd === 'npx' || cmd === 'npx.cmd').toBe(true)
  })

  it('prefers pnpm dlx when running under pnpm', () => {
    process.env.npm_config_user_agent = 'pnpm/10.28.0 npm/? node/v23.8.0'

    const cmd = browserInstallCommand('chrome')
    expect(cmd === 'pnpm' || cmd === 'pnpm.cmd').toBe(true)
    expect(browserInstallArgs('chrome', '/tmp/x')).toEqual([
      'dlx',
      '@puppeteer/browsers@latest',
      'install',
      'chrome@stable',
      '--path',
      '/tmp/x'
    ])
  })

  it('detects sudo-driven edge installation failures', () => {
    expect(
      isEdgePrivilegeEscalationFailure(
        'Switching to root user to install dependencies...'
      )
    ).toBe(true)
    expect(
      isEdgePrivilegeEscalationFailure(
        'sudo: a terminal is required to read the password'
      )
    ).toBe(true)
    expect(isEdgePrivilegeEscalationFailure('random error')).toBe(false)
  })
})

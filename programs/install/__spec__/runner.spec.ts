import {describe, expect, it} from 'vitest'
import {
  browserInstallArgs,
  browserInstallEnv,
  browserInstallCommand,
  isEdgePrivilegeEscalationFailure
} from '../lib/runner'

describe('install runner mapping', () => {
  it('maps chromium-family browsers to puppeteer installer args', () => {
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

  it('returns npx command variant by platform', () => {
    const cmd = browserInstallCommand('firefox')
    expect(cmd === 'npx' || cmd === 'npx.cmd').toBe(true)
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

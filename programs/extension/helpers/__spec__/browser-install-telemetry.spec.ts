import {afterEach, describe, expect, it} from 'vitest'
import {
  readBrowserInstall,
  recordBrowserInstall,
  resetBrowserInstall
} from '../browser-install-outcome'
import {telemetryCommandContext} from '../telemetry-cli'

afterEach(() => {
  resetBrowserInstall()
})

describe('browser install outcome', () => {
  it('records nothing until an offer is made', () => {
    expect(readBrowserInstall()).toBeNull()
    expect(telemetryCommandContext('dev')).toEqual({})
  })

  it('reaches the command event as fixed values, never a path', () => {
    recordBrowserInstall('accepted', 'chrome', 42.4)
    expect(telemetryCommandContext('dev')).toEqual({
      browser_install: 'accepted',
      browser_install_browser: 'chrome',
      browser_install_seconds: 42
    })
  })

  it('keeps the last outcome, since they describe one offer', () => {
    recordBrowserInstall('offered', 'chrome')
    recordBrowserInstall('declined', 'chrome')
    expect(readBrowserInstall()?.outcome).toBe('declined')
  })

  it('omits a duration that is not a real measurement', () => {
    recordBrowserInstall('offered', 'edge')
    expect(telemetryCommandContext('dev')).toEqual({
      browser_install: 'offered',
      browser_install_browser: 'edge'
    })

    recordBrowserInstall('failed', 'edge', Number.NaN)
    expect(readBrowserInstall()?.seconds).toBeUndefined()

    recordBrowserInstall('failed', 'edge', -3)
    expect(readBrowserInstall()?.seconds).toBeUndefined()
  })

  it('travels alongside the create properties rather than replacing them', () => {
    recordBrowserInstall('declined', 'chrome')
    const context = telemetryCommandContext('create', [
      'node',
      'extension',
      'create',
      'my-extension',
      '--template',
      'react'
    ])
    expect(context.browser_install).toBe('declined')
    expect(context.template).toBe('react')
    expect(context.source).toBe('cli')
  })
})

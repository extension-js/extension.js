import {describe, expect, it, vi} from 'vitest'
import {
  buildBrowserLaunchRequest,
  pickSharedBrowserRuntimeOptions,
  toExtensionLoadList
} from '../browsers-lib/runtime-options'

describe('browser runtime-options helpers', () => {
  it('picks only the shared browser runtime options', () => {
    expect(
      pickSharedBrowserRuntimeOptions({
        extension: ['/tmp/ext-a', '/tmp/ext-b'],
        browser: 'firefox',
        noOpen: true,
        browserFlags: ['--flag'],
        excludeBrowserFlags: ['--other'],
        profile: '/tmp/profile',
        preferences: {'devtools.console.stdout.content': true},
        startingUrl: 'https://example.com/',
        instanceId: 'run-1',
        port: 9333,
        dryRun: false,
        logLevel: 'info',
        logContexts: ['reload'],
        logFormat: 'plain',
        logTimestamps: true,
        logColor: false,
        logUrl: true,
        logTab: true
      } as any)
    ).toEqual({
      extension: ['/tmp/ext-a', '/tmp/ext-b'],
      browser: 'firefox',
      noOpen: true,
      browserFlags: ['--flag'],
      excludeBrowserFlags: ['--other'],
      profile: '/tmp/profile',
      preferences: {'devtools.console.stdout.content': true},
      startingUrl: 'https://example.com/',
      instanceId: 'run-1',
      port: 9333,
      dryRun: false,
      logLevel: 'info',
      logContexts: ['reload'],
      logFormat: 'plain',
      logTimestamps: true,
      logColor: false,
      logUrl: true,
      logTab: true
    })
  })

  it('builds launch requests and normalizes extension load lists', () => {
    expect(
      buildBrowserLaunchRequest(
        {
          browser: 'chromium',
          browserFlags: ['--auto-open-devtools-for-tabs'],
          excludeBrowserFlags: ['--mute-audio'],
          profile: '/tmp/profile',
          preferences: {homepage: 'about:blank'},
          startingUrl: 'https://example.com/',
          port: 9222
        },
        'development',
        {persistProfile: true}
      )
    ).toEqual({
      browser: 'chromium',
      browserFlags: ['--auto-open-devtools-for-tabs'],
      excludeBrowserFlags: ['--mute-audio'],
      profile: '/tmp/profile',
      preferences: {homepage: 'about:blank'},
      startingUrl: 'https://example.com/',
      port: 9222,
      mode: 'development',
      persistProfile: true
    })

    expect(toExtensionLoadList('/tmp/ext')).toEqual(['/tmp/ext'])
    expect(toExtensionLoadList(['/tmp/ext-a', '/tmp/ext-b'])).toEqual([
      '/tmp/ext-a',
      '/tmp/ext-b'
    ])
  })
})

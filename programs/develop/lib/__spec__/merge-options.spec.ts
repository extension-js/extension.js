import {describe, expect, it} from 'vitest'
import {
  BUILD_COMMAND_DEFAULTS,
  DEV_COMMAND_DEFAULTS,
  mergeOptionLayers,
  SERVE_COMMAND_DEFAULTS,
  START_BUILD_DEFAULTS
} from '../merge-options'

describe('mergeOptionLayers', () => {
  it('applies stock defaults when neither config nor CLI sets a value', () => {
    expect(
      mergeOptionLayers<Record<string, any>>(DEV_COMMAND_DEFAULTS)
    ).toMatchObject({
      polyfill: true,
      logFormat: 'pretty',
      logTimestamps: true,
      logColor: true,
      logLevel: 'off',
      noOpen: false
    })
    expect(
      mergeOptionLayers<Record<string, any>>(BUILD_COMMAND_DEFAULTS)
    ).toMatchObject({
      polyfill: false,
      zip: false,
      zipSource: false,
      silent: false
    })
    expect(
      mergeOptionLayers<Record<string, any>>(SERVE_COMMAND_DEFAULTS)
    ).toMatchObject({
      logFormat: 'pretty',
      logLevel: 'off'
    })
    expect(
      mergeOptionLayers<Record<string, any>>(START_BUILD_DEFAULTS)
    ).toMatchObject({
      polyfill: true,
      silent: true
    })
  })

  it('lets config-only values beat stock defaults (config-only)', () => {
    const merged = mergeOptionLayers<Record<string, any>>(
      DEV_COMMAND_DEFAULTS,
      {startingUrl: 'https://from-browser.example', polyfill: true},
      {
        polyfill: false,
        logFormat: 'json',
        noOpen: true,
        startingUrl: 'https://from-commands-dev.example'
      }
    )
    expect(merged).toMatchObject({
      polyfill: false,
      logFormat: 'json',
      noOpen: true,
      startingUrl: 'https://from-commands-dev.example',
      // Still from defaults when no layer sets them.
      logTimestamps: true,
      logColor: true,
      logLevel: 'off'
    })
  })

  it('lets flag-only values beat stock defaults (flag-only)', () => {
    const merged = mergeOptionLayers<Record<string, any>>(
      DEV_COMMAND_DEFAULTS,
      {},
      {},
      {polyfill: false, logFormat: 'ndjson'}
    )
    expect(merged).toMatchObject({
      polyfill: false,
      logFormat: 'ndjson',
      logTimestamps: true
    })
  })

  it('lets explicit CLI values beat config in both directions (both)', () => {
    // CLI turns silence and zip off over a quiet-by-default config.
    expect(
      mergeOptionLayers<Record<string, any>>(
        BUILD_COMMAND_DEFAULTS,
        {silent: true, zip: true, polyfill: true},
        {silent: false, zip: false}
      )
    ).toMatchObject({
      silent: false,
      zip: false,
      polyfill: true
    })

    // CLI turns the polyfill on over config false.
    expect(
      mergeOptionLayers<Record<string, any>>(
        DEV_COMMAND_DEFAULTS,
        {polyfill: false, logFormat: 'json'},
        {polyfill: true, logFormat: 'pretty'}
      )
    ).toMatchObject({
      polyfill: true,
      logFormat: 'pretty'
    })
  })

  it('ignores undefined CLI keys so config is not clobbered (neither typed)', () => {
    const merged = mergeOptionLayers<Record<string, any>>(
      BUILD_COMMAND_DEFAULTS,
      {zip: true, silent: true, polyfill: false},
      {
        zip: undefined,
        silent: undefined,
        polyfill: undefined,
        browser: 'chrome'
      }
    )
    expect(merged).toMatchObject({
      zip: true,
      silent: true,
      polyfill: false,
      browser: 'chrome'
    })
  })

  it('concatenates browserFlags and excludeBrowserFlags across layers with dedup', () => {
    const merged = mergeOptionLayers<Record<string, any>>(
      DEV_COMMAND_DEFAULTS,
      {
        browserFlags: ['--from-browser', '--shared'],
        excludeBrowserFlags: ['--exclude-browser', '--exclude-shared']
      },
      {
        browserFlags: ['--from-command', '--shared'],
        excludeBrowserFlags: ['--exclude-command', '--exclude-shared']
      },
      {
        browserFlags: ['--from-cli'],
        excludeBrowserFlags: undefined
      }
    )
    // Order preserved, repeated entries appear once (first occurrence wins).
    expect(merged.browserFlags).toEqual([
      '--from-browser',
      '--shared',
      '--from-command',
      '--from-cli'
    ])
    expect(merged.excludeBrowserFlags).toEqual([
      '--exclude-browser',
      '--exclude-shared',
      '--exclude-command'
    ])
  })

  it('does not replace an earlier flags list when a later layer omits it', () => {
    const merged = mergeOptionLayers<Record<string, any>>(
      DEV_COMMAND_DEFAULTS,
      {browserFlags: ['--from-browser']},
      {polyfill: false},
      {startingUrl: 'https://cli.example'}
    )
    expect(merged.browserFlags).toEqual(['--from-browser'])
  })

  it('keeps exclusion subtraction working on merged lists', () => {
    // An exclusion contributed by any layer must remove its target from a
    // default-flag list exactly like a single-layer exclusion would, and the
    // dedup must not drop distinct exclusions.
    const merged = mergeOptionLayers<Record<string, any>>(
      DEV_COMMAND_DEFAULTS,
      {excludeBrowserFlags: ['--disable-default-a']},
      {excludeBrowserFlags: ['--disable-default-b']},
      {excludeBrowserFlags: ['--disable-default-b']}
    )
    const defaults = [
      '--disable-default-a',
      '--disable-default-b',
      '--kept-default'
    ]
    const filtered = defaults.filter(
      (flag) =>
        !(merged.excludeBrowserFlags as string[]).some(
          (exclude) => exclude === flag
        )
    )
    expect(merged.excludeBrowserFlags).toEqual([
      '--disable-default-a',
      '--disable-default-b'
    ])
    expect(filtered).toEqual(['--kept-default'])
  })

  it('deep-merges preferences with later layers winning on conflict', () => {
    const merged = mergeOptionLayers<Record<string, any>>(
      DEV_COMMAND_DEFAULTS,
      {
        preferences: {a: 1, nested: {x: 1, keep: true}, onlyBrowser: 'browser'}
      },
      {
        preferences: {b: 2, nested: {y: 2}, onlyCommand: 'command'}
      },
      {
        preferences: {a: 99, nested: {x: 3}, onlyCli: 'cli'}
      }
    )
    expect(merged.preferences).toEqual({
      a: 99,
      b: 2,
      nested: {x: 3, keep: true, y: 2},
      onlyBrowser: 'browser',
      onlyCommand: 'command',
      onlyCli: 'cli'
    })
  })

  it('keeps scalar last-wins while combining flags and preferences', () => {
    const merged = mergeOptionLayers<Record<string, any>>(
      DEV_COMMAND_DEFAULTS,
      {
        polyfill: true,
        startingUrl: 'https://browser.example',
        browserFlags: ['--browser-flag'],
        preferences: {theme: 'light', fontSize: 12}
      },
      {
        polyfill: false,
        startingUrl: 'https://command.example',
        browserFlags: ['--command-flag'],
        preferences: {theme: 'dark'}
      },
      {
        startingUrl: 'https://cli.example',
        browserFlags: ['--cli-flag'],
        preferences: {fontSize: 14}
      }
    )
    expect(merged).toMatchObject({
      polyfill: false,
      startingUrl: 'https://cli.example',
      browserFlags: ['--browser-flag', '--command-flag', '--cli-flag'],
      preferences: {theme: 'dark', fontSize: 14}
    })
  })
})

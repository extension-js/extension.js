import {describe, expect, it} from 'vitest'
import {locatorEnv} from '../browsers-lib/locator-env'

const windowsBase = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ProgramW6432: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\cosmo\\AppData\\Local',
  APPDATA: 'C:\\Users\\cosmo\\AppData\\Roaming',
  SystemRoot: 'C:\\Windows',
  Path: 'C:\\Windows\\system32'
}

describe('locatorEnv', () => {
  it('answers the upper-case Windows names a locator reads on win32', () => {
    const env = locatorEnv(windowsBase, {}, 'win32')

    expect(env.PROGRAMFILES).toBe('C:\\Program Files')
    expect(env['PROGRAMFILES(X86)']).toBe('C:\\Program Files (x86)')
    expect(env.PROGRAMW6432).toBe('C:\\Program Files')
    expect(env.LOCALAPPDATA).toBe('C:\\Users\\cosmo\\AppData\\Local')
    expect(env.APPDATA).toBe('C:\\Users\\cosmo\\AppData\\Roaming')
    expect(env.SYSTEMROOT).toBe('C:\\Windows')
    expect(env.PATH).toBe('C:\\Windows\\system32')
  })

  it('keeps the OS spelling next to the mirrored one', () => {
    const env = locatorEnv(windowsBase, {}, 'win32')

    expect(env.ProgramFiles).toBe('C:\\Program Files')
    expect(env['ProgramFiles(x86)']).toBe('C:\\Program Files (x86)')
  })

  it('layers the managed cache override on top of both spellings', () => {
    const env = locatorEnv(
      {...windowsBase, Playwright_Browsers_Path: 'D:\\elsewhere'},
      {PLAYWRIGHT_BROWSERS_PATH: 'C:\\cache\\edge'},
      'win32'
    )

    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('C:\\cache\\edge')
    expect(env.PROGRAMFILES).toBe('C:\\Program Files')
  })

  it('never invents an upper-case twin that the OS already answers', () => {
    const env = locatorEnv(
      {PROGRAMFILES: 'C:\\Real', ProgramFiles: 'C:\\Shadow'},
      {},
      'win32'
    )

    expect(env.PROGRAMFILES).toBe('C:\\Real')
  })

  it('copies the env as-is off Windows', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const env = locatorEnv(
        {Home: '/mixed', HOME: '/home/dev'},
        {PUPPETEER_CACHE_DIR: '/cache/chrome'},
        platform
      )

      expect(Object.keys(env).sort()).toEqual([
        'HOME',
        'Home',
        'PUPPETEER_CACHE_DIR'
      ])

      expect(env.HOME).toBe('/home/dev')
    }
  })

  it('leaves the base env untouched', () => {
    const base = {...windowsBase}
    locatorEnv(base, {PLAYWRIGHT_BROWSERS_PATH: 'C:\\cache\\edge'}, 'win32')

    expect(base).toEqual(windowsBase)
  })
})

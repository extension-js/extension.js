import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {resolveBrowsersCacheRoot} from '../lib/cache-root'
import {
  BrowserNotInstallableError,
  BrowserUninstallError,
  extensionUninstall,
  getManagedBrowsersCacheRoot,
  type UninstallOptions
} from '../module'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-uninstall-'))
const guardRoot = path.join(scratch, 'guard-cache')

afterAll(() => {
  fs.rmSync(scratch, {recursive: true, force: true})
})

const MAC_EDGE =
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'

function never(): never {
  throw new Error('this case must not ask the system for Edge')
}

const NOT_OURS = "it holds files Extension.js didn't put there"
const NOT_OURS_REMEDY =
  'Extension.js removes only the folders it installed, ' +
  'so delete that one yourself if you mean to.'

const REQUIRES_TARGET =
  'A browser target is required. ' +
  'Pass --browser <name>, or --all to remove every browser.'

function plantTree(cacheRoot: string, browser: string): string {
  const build = path.join(cacheRoot, browser, 'linux-152.0.9999.1')
  fs.mkdirSync(build, {recursive: true})
  const binary = path.join(build, 'browser-stub')
  fs.writeFileSync(binary, 'stub')

  return binary
}

describe('extensionUninstall on a temp cache root', () => {
  let cacheRoot = ''
  let env: Record<string, string | undefined> = {}
  let logged: string[] = []
  let stderr: string[] = []

  // No case runs until both the root it names and the root the process would
  // fall back to are folders this file made.
  beforeEach(() => {
    cacheRoot = fs.mkdtempSync(path.join(scratch, 'cache-'))
    env = {EXT_BROWSERS_CACHE_DIR: cacheRoot}
    logged = []
    stderr = []
    vi.stubEnv('EXT_BROWSERS_CACHE_DIR', guardRoot)
    vi.stubEnv('EXTENSION_OUTPUT', '')
    vi.spyOn(console, 'log').mockImplementation((line) => {
      logged.push(stripVTControlCharacters(String(line)))
    })

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(stripVTControlCharacters(String(chunk)))

      return true
    })

    expect(resolveBrowsersCacheRoot(env)).toBe(cacheRoot)
    expect(path.dirname(cacheRoot)).toBe(scratch)
    expect(getManagedBrowsersCacheRoot()).toBe(guardRoot)
    expect(path.dirname(guardRoot)).toBe(scratch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    expect(fs.existsSync(guardRoot)).toBe(false)
  })

  // No case asks this machine whether it has an Edge: the lookup is injected.
  function uninstall(options: UninstallOptions): Promise<unknown> {
    return extensionUninstall({
      env,
      platform: 'darwin',
      systemEdge: {exists: () => false, lookup: never, registry: never},
      ...options
    }).catch((thrown: unknown) => thrown)
  }

  function row(
    browser: string,
    outcome: 'removed' | 'absent',
    extra: Record<string, string> = {}
  ) {
    return {
      browser,
      removed: outcome === 'removed',
      path: at(browser),
      outcome,
      ...extra
    }
  }

  function at(browser: string): string {
    return path.join(cacheRoot, browser)
  }

  describe('a call that names nothing to remove', () => {
    it.each([
      {name: 'no target at all', options: {}},
      {name: 'an empty name', options: {browser: ''}},
      {name: 'a blank name', options: {browser: '   '}},
      {name: 'a lone comma', options: {browser: ','}},
      {name: 'commas and blanks', options: {browser: ' , ,, '}},
      {name: 'all set to false', options: {all: false}}
    ])('refuses $name and leaves the cache alone', async ({options}) => {
      const chrome = plantTree(cacheRoot, 'chrome')

      const error = await uninstall(options)

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).name).toBe('Error')
      expect((error as Error).message).toBe(REQUIRES_TARGET)
      expect(logged).toEqual([])
      expect(fs.existsSync(chrome)).toBe(true)
    })

    it('refuses a list with a name it cannot remove before removing any', async () => {
      const chrome = plantTree(cacheRoot, 'chrome')

      const error = await uninstall({browser: 'chrome,brave'})

      expect(error).toBeInstanceOf(BrowserNotInstallableError)
      expect((error as BrowserNotInstallableError).code).toBe(
        'BROWSER_NOT_INSTALLABLE'
      )

      expect((error as Error).message).toBe(
        'brave cannot be installed by Extension.js. This CLI never downloads ' +
          'it; it is located from the system when present. Managed installs ' +
          'cover: chrome, chromium, edge, firefox, chromium-based, ' +
          'gecko-based, firefox-based.'
      )

      expect(logged).toEqual([])
      expect(fs.existsSync(chrome)).toBe(true)
    })
  })

  describe('named browsers', () => {
    it('removes what is there, reports what is absent, and says both', async () => {
      plantTree(cacheRoot, 'chrome')
      const firefox = plantTree(cacheRoot, 'firefox')

      expect(await uninstall({browser: 'chrome,edge'})).toEqual([
        row('chrome', 'removed'),
        row('edge', 'absent')
      ])

      expect(logged).toEqual([
        `⏵⏵⏵ Removing the browser binaries for chrome, edge…\nPATH ${cacheRoot}`,
        `⏵⏵⏵ Chrome is removed.\nPATH ${at('chrome')}`,
        `⏵⏵⏵ Edge is already absent.\nPATH ${at('edge')}`
      ])

      expect(fs.readdirSync(cacheRoot)).toEqual(['firefox'])
      expect(fs.existsSync(firefox)).toBe(true)
    })

    it('reports a missing browser as already absent and removes nothing', async () => {
      const chrome = plantTree(cacheRoot, 'chrome')

      expect(await uninstall({browser: 'firefox'})).toEqual([
        row('firefox', 'absent')
      ])

      expect(logged).toEqual([
        `⏵⏵⏵ Removing the browser binaries for firefox…\nPATH ${cacheRoot}`,
        `⏵⏵⏵ Firefox is already absent.\nPATH ${at('firefox')}`
      ])

      expect(fs.existsSync(chrome)).toBe(true)
    })

    it('trims names, resolves aliases, and removes a repeated name once', async () => {
      plantTree(cacheRoot, 'chromium')
      plantTree(cacheRoot, 'firefox')

      expect(
        await uninstall({
          browser: ' Chromium-Based , gecko-based,,firefox,chromium'
        })
      ).toEqual([row('chromium', 'removed'), row('firefox', 'removed')])

      expect(logged).toEqual([
        `⏵⏵⏵ Removing the browser binaries for chromium, firefox…\nPATH ${cacheRoot}`,
        `⏵⏵⏵ Chromium is removed.\nPATH ${at('chromium')}`,
        `⏵⏵⏵ Firefox is removed.\nPATH ${at('firefox')}`
      ])

      expect(fs.readdirSync(cacheRoot)).toEqual([])
    })

    // A file at the path is nothing an install made, so it is not removed.
    it('leaves a browser path that is a file and not a folder, and says why', async () => {
      fs.writeFileSync(at('chrome'), 'not a folder')

      const error = await uninstall({browser: 'chrome'})

      expect(error).toBeInstanceOf(BrowserUninstallError)
      expect((error as Error).message).toBe(
        `Couldn't remove Chrome. ${at('chrome')} was left untouched ` +
          `(${NOT_OURS}). ${NOT_OURS_REMEDY}`
      )

      expect(fs.readFileSync(at('chrome'), 'utf8')).toBe('not a folder')
    })

    it('moves its lines to stderr and keeps stdout empty under machine output', async () => {
      vi.stubEnv('EXTENSION_OUTPUT', 'json')
      plantTree(cacheRoot, 'chrome')

      await uninstall({browser: 'chrome,edge'})

      expect(logged).toEqual([])
      expect(process.stdout.write).not.toHaveBeenCalled()
      expect(stderr).toEqual([
        `⏵⏵⏵ Removing the browser binaries for chrome, edge…\nPATH ${cacheRoot}\n`,
        `⏵⏵⏵ Chrome is removed.\nPATH ${at('chrome')}\n`,
        `⏵⏵⏵ Edge is already absent.\nPATH ${at('edge')}\n`
      ])
    })
  })

  describe('all', () => {
    it('removes the four browser folders and nothing else in the root', async () => {
      plantTree(cacheRoot, 'chrome')
      plantTree(cacheRoot, 'firefox')
      plantTree(cacheRoot, 'brave')
      fs.writeFileSync(path.join(cacheRoot, 'notes.txt'), 'kept')

      expect(await uninstall({all: true})).toEqual([
        row('chrome', 'removed'),
        row('chromium', 'absent'),
        row('edge', 'absent'),
        row('firefox', 'removed')
      ])

      expect(logged[0]).toBe(
        '⏵⏵⏵ Removing the browser binaries for chrome, chromium, edge, firefox…\n' +
          `PATH ${cacheRoot}`
      )

      expect(fs.readdirSync(cacheRoot).sort()).toEqual(['brave', 'notes.txt'])
    })

    // One browser or every browser: a guess between the two could remove
    // the ones the caller meant to keep, so nothing is removed.
    it('refuses a name passed beside it and removes nothing', async () => {
      plantTree(cacheRoot, 'firefox')

      const error = await uninstall({all: true, browser: 'chrome'})

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(
        'Pass --browser <name> to remove one browser, or --all to remove ' +
          'every browser, not both.'
      )

      expect(fs.readdirSync(cacheRoot)).toEqual(['firefox'])
      expect(logged).toEqual([])
    })

    it('still takes all beside a blank name', async () => {
      plantTree(cacheRoot, 'firefox')

      await uninstall({all: true, browser: '  '})

      expect(fs.readdirSync(cacheRoot)).toEqual([])
    })

    it('keeps going past a removal that throws, then rejects once with every outcome', async () => {
      plantTree(cacheRoot, 'chrome')
      plantTree(cacheRoot, 'chromium')
      plantTree(cacheRoot, 'firefox')
      const reason = `EBUSY: resource busy or locked, rmdir '${at('chromium')}'`
      const removalError = Object.assign(new Error(reason), {
        code: 'EBUSY',
        syscall: 'rmdir',
        path: at('chromium')
      })
      const removeTree = vi.fn((dir: string) => {
        if (dir === at('chromium')) throw removalError

        fs.rmSync(dir, {recursive: true, force: true})
      })

      const error = await uninstall({all: true, removeTree})

      expect(error).toBeInstanceOf(BrowserUninstallError)
      expect((error as Error).name).toBe('BrowserUninstallError')
      expect((error as BrowserUninstallError).code).toBe('BROWSER_UNINSTALL')
      expect((error as Error).message).toBe(
        `Couldn't remove Chromium. ${at('chromium')} is still there (${reason}). ` +
          `Close any browser running from that folder, then run the uninstall again.`
      )

      expect((error as {cause?: unknown}).cause).toBe(removalError)
      expect((error as BrowserUninstallError).results).toEqual([
        row('chrome', 'removed'),
        {
          browser: 'chromium',
          removed: false,
          path: at('chromium'),
          outcome: 'failed',
          kind: 'removal',
          reason
        },
        row('edge', 'absent'),
        row('firefox', 'removed')
      ])

      expect(removeTree.mock.calls).toEqual([
        [at('chrome')],
        [at('chromium')],
        [at('firefox')]
      ])

      expect(fs.readdirSync(cacheRoot)).toEqual(['chromium'])
      expect(logged).toEqual([
        '⏵⏵⏵ Removing the browser binaries for chrome, chromium, edge, firefox…\n' +
          `PATH ${cacheRoot}`,
        `⏵⏵⏵ Chrome is removed.\nPATH ${at('chrome')}`,
        `⏵⏵⏵ Edge is already absent.\nPATH ${at('edge')}`,
        `⏵⏵⏵ Firefox is removed.\nPATH ${at('firefox')}`
      ])
    })

    it('lists every folder that would not go, with the failures gathered as the cause', async () => {
      plantTree(cacheRoot, 'chrome')
      plantTree(cacheRoot, 'firefox')
      const removeTree = vi.fn((dir: string) => {
        throw new Error(`EPERM: operation not permitted, rmdir '${dir}'\nat x`)
      })

      const error = await uninstall({browser: 'chrome,firefox', removeTree})

      expect(error).toBeInstanceOf(BrowserUninstallError)
      expect((error as Error).message).toBe(
        `Couldn't remove Chrome, Firefox. ` +
          `${at('chrome')} is still there (EPERM: operation not permitted, rmdir '${at('chrome')}'). ` +
          `${at('firefox')} is still there (EPERM: operation not permitted, rmdir '${at('firefox')}'). ` +
          `Close any browser running from that folder, then run the uninstall again.`
      )

      const cause = (error as {cause?: unknown}).cause
      expect(cause).toBeInstanceOf(AggregateError)
      expect((cause as AggregateError).errors).toHaveLength(2)
      expect(
        (error as BrowserUninstallError).results.map((result) => [
          result.outcome,
          result.kind
        ])
      ).toEqual([
        ['failed', 'removal'],
        ['failed', 'removal']
      ])
    })

    // The real removal, on a real folder this user may not empty. Only a
    // posix user who is not root can be denied this way.
    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
      'names the folder that refused for permissions, not a folder that is not empty',
      async () => {
        plantTree(cacheRoot, 'chrome')
        const locked = path.join(at('chrome'), 'linux-152.0.9999.1')
        fs.chmodSync(locked, 0o555)

        try {
          const error = await uninstall({browser: 'chrome'})
          const reason = `EACCES: permission denied, no write access to '${locked}'`

          expect(error).toBeInstanceOf(BrowserUninstallError)
          expect((error as BrowserUninstallError).results).toEqual([
            {
              browser: 'chrome',
              removed: false,
              path: at('chrome'),
              outcome: 'failed',
              kind: 'permission',
              reason
            }
          ])

          expect((error as Error).message).toBe(
            `Couldn't remove Chrome. ${at('chrome')} is still there (${reason}). ` +
              'Give your user write access to that folder, or remove it ' +
              'yourself, then run the uninstall again.'
          )

          expect(
            (error as {cause?: {cause?: unknown}}).cause?.cause
          ).toMatchObject({code: 'ENOTEMPTY'})
        } finally {
          fs.chmodSync(locked, 0o755)
        }
      }
    )
  })

  describe('Edge, which its installer places system-wide', () => {
    it('says a system Edge is not removed, names it, and is not an error', async () => {
      const exists = vi.fn((file: string) => file === MAC_EDGE)

      expect(
        await uninstall({
          browser: 'edge',
          systemEdge: {exists, lookup: never, registry: never}
        })
      ).toEqual([
        {
          browser: 'edge',
          removed: false,
          path: at('edge'),
          outcome: 'system',
          systemPath: MAC_EDGE
        }
      ])

      expect(exists.mock.calls).toEqual([[MAC_EDGE]])
      expect(logged).toEqual([
        `⏵⏵⏵ Removing the browser binaries for edge…\nPATH ${cacheRoot}`,
        "⏵⏵⏵ Edge is a system install that Extension.js doesn't remove.\n" +
          `PATH ${MAC_EDGE}`
      ])
    })

    it('keeps already absent when no system Edge exists', async () => {
      expect(await uninstall({browser: 'edge'})).toEqual([
        row('edge', 'absent')
      ])

      expect(logged[1]).toBe(`⏵⏵⏵ Edge is already absent.\nPATH ${at('edge')}`)
    })

    it('removes a managed Edge folder without asking for a system Edge', async () => {
      plantTree(cacheRoot, 'edge')

      expect(
        await uninstall({
          browser: 'edge',
          systemEdge: {exists: never, lookup: never, registry: never}
        })
      ).toEqual([row('edge', 'removed')])

      expect(logged[1]).toBe(`⏵⏵⏵ Edge is removed.\nPATH ${at('edge')}`)
    })

    it('asks only for Edge, and on the platform it is handed', async () => {
      const lookup = vi.fn((_tool: string, name: string) =>
        name === 'microsoft-edge' ? '/usr/bin/microsoft-edge' : null
      )

      const results = (await uninstall({
        all: true,
        platform: 'linux',
        systemEdge: {exists: never, lookup, registry: never}
      })) as Array<{outcome: string; systemPath?: string}>

      expect(results.map((result) => result.outcome)).toEqual([
        'absent',
        'absent',
        'system',
        'absent'
      ])

      expect(results[2].systemPath).toBe('/usr/bin/microsoft-edge')
      expect(lookup.mock.calls).toEqual([['which', 'microsoft-edge']])
    })
  })
})

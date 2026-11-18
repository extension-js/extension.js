import fs from 'node:fs'
import path from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'
import {cliHome, everyLineAsFrame, runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()

// The helper's env keeps every case off this machine: the cache root is an
// empty temp folder and the system scan is off, so no Edge is asked for.
function run(args: string[], env: Record<string, string> = {}) {
  return runCli(args, {env})
}

type ErrorFrame = {
  command: string
  status: string
  error: {code: string; message: string}
}

async function refusal(args: string[]) {
  const result = await run(args)
  const frames = everyLineAsFrame<ErrorFrame>(result.stdout)

  expect(result.status, result.output).toBe(1)
  expect(frames).toHaveLength(1)

  return frames[0]
}

describe('install/uninstall refusal codes under --output json', () => {
  // Scripts branch on the envelope code alone. Three situations, three codes:
  //   unknown name       → E_UNSUPPORTED_BROWSER
  //   known, never fetch → E_BROWSER_NOT_INSTALLABLE
  //   managed download   → E_BROWSER_DOWNLOAD (covered in unit tests)
  // Install and uninstall, with and without --where, must agree.
  it.each([
    'install',
    'uninstall'
  ])('%s frames an unknown name as E_UNSUPPORTED_BROWSER', async (command) => {
    const frame = await refusal([command, 'netscape', '--output', 'json'])

    expect(frame).toMatchObject({command, status: 'usage'})
    expect(frame.error).toEqual({
      code: 'E_UNSUPPORTED_BROWSER',
      message: 'Unsupported browser: netscape.'
    })
  })

  it.each([
    [['install', 'brave', '--output', 'json']],
    [['install', 'brave', '--where', '--output', 'json']],
    [['uninstall', 'brave', '--output', 'json']],
    [['uninstall', 'brave', '--where', '--output', 'json']]
  ])('frames brave as E_BROWSER_NOT_INSTALLABLE, with what to do instead: %j', async (args) => {
    const frame = await refusal(args)

    expect(frame).toMatchObject({command: args[0], status: 'usage'})
    expect(frame.error).toEqual({
      code: 'E_BROWSER_NOT_INSTALLABLE',
      message:
        'brave cannot be installed by Extension.js. This CLI never downloads ' +
        'it. It is located from the system when present. Install it ' +
        'yourself, then run with --browser=brave. Managed installs cover: ' +
        'chrome, chromium, edge, firefox.'
    })
  })

  it('frames safari as E_BROWSER_NOT_INSTALLABLE with the Xcode guidance', async () => {
    const frame = await refusal([
      'install',
      'safari',
      '--where',
      '--output',
      'json'
    ])

    expect(frame.error).toEqual({
      code: 'E_BROWSER_NOT_INSTALLABLE',
      message:
        'There is no Safari binary to install. Safari ships with macOS. ' +
        'Safari builds need the full Xcode app instead (Mac App Store), ' +
        'then run `extension build --browser safari`.'
    })
  })

  it('accepts comma lists on uninstall the same as install', async () => {
    const root = cliHome().browsersCache
    const expected = [path.join(root, 'chrome'), path.join(root, 'edge')]

    for (const command of ['install', 'uninstall']) {
      const result = await run([
        command,
        'chrome,edge',
        '--where',
        '--output',
        'json'
      ])

      expect(result.status, result.output).toBe(0)
      expect(everyLineAsFrame(result.stdout)).toEqual([
        {
          schema: 1,
          ok: true,
          command,
          status: 'located',
          value: {paths: expected},
          error: null,
          warnings: []
        }
      ])
    }
  })

  it('still locates managed browsers as a success envelope', async () => {
    const result = await run([
      'install',
      'chrome',
      '--where',
      '--output',
      'json'
    ])

    expect(result.status).toBe(0)
    expect(everyLineAsFrame(result.stdout)).toEqual([
      {
        schema: 1,
        ok: true,
        command: 'install',
        status: 'located',
        value: {paths: [path.join(cliHome().browsersCache, 'chrome')]},
        error: null,
        warnings: []
      }
    ])
  })
})

describe('uninstall under --output json against a temp cache root', () => {
  const BUILD = 'linux-152.0.9999.1'
  let cacheRoot = ''

  beforeEach(() => {
    cacheRoot = makeTempFolder('extjs-uninstall-cli-')
    // A build folder as the installer names it. An empty folder holds no
    // browser, so removing one is reported as nothing to remove.
    fs.mkdirSync(path.join(cacheRoot, 'chrome', BUILD), {recursive: true})
  })

  it('puts exactly one JSON document on stdout for a real removal', async () => {
    const result = await run(['uninstall', 'chrome', '--output', 'json'], {
      EXT_BROWSERS_CACHE_DIR: cacheRoot
    })

    expect(result.status).toBe(0)
    const frame = JSON.parse(result.stdout) as Record<string, unknown>
    expect(frame).toMatchObject({
      schema: 1,
      ok: true,
      command: 'uninstall',
      status: 'uninstalled',
      warnings: []
    })

    const value = frame.value as {
      results: Array<{browser: string; removed: boolean; path: string}>
    }
    expect(value.results).toHaveLength(1)
    expect(value.results[0].browser).toBe('chrome')
    expect(value.results[0].removed).toBe(true)
    expect(value.results[0].path).toMatch(/[\\/]chrome$/)
    expect(fs.existsSync(path.join(cacheRoot, 'chrome'))).toBe(false)
  })

  it('warns E_UNINSTALL_NOOP when the browser was never there', async () => {
    const result = await run(['uninstall', 'edge', '--output', 'json'], {
      EXT_BROWSERS_CACHE_DIR: cacheRoot
    })

    expect(result.status).toBe(0)
    const frame = JSON.parse(result.stdout) as Record<string, unknown>
    expect(frame.ok).toBe(true)
    expect(frame.status).toBe('noop')
    expect(frame.warnings).toEqual([
      'E_UNINSTALL_NOOP: Nothing to remove for edge.'
    ])

    const value = frame.value as {
      results: Array<{removed: boolean; outcome: string}>
    }
    expect(value.results.map((entry) => entry.removed)).toEqual([false])
    expect(value.results.map((entry) => entry.outcome)).toEqual(['absent'])
  })

  it('removes a name given twice once', async () => {
    const result = await run(
      ['uninstall', 'chrome,chrome', '--output', 'json'],
      {
        EXT_BROWSERS_CACHE_DIR: cacheRoot
      }
    )

    expect(result.status).toBe(0)
    const frame = JSON.parse(result.stdout) as Record<string, unknown>
    const value = frame.value as {
      results: Array<{browser: string; outcome: string}>
    }
    expect(frame.status).toBe('uninstalled')
    expect(
      value.results.map((entry) => [entry.browser, entry.outcome])
    ).toEqual([['chrome', 'removed']])
  })

  // A folder that cannot be written to keeps its files, which is the one
  // removal failure a test can stage without a second process. Root ignores it.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'keeps going past a folder that will not go, then exits 1 with every outcome',
    async () => {
      const locked = path.join(cacheRoot, 'chrome', BUILD)
      fs.writeFileSync(path.join(locked, 'chrome'), 'stub')
      fs.mkdirSync(path.join(cacheRoot, 'firefox', BUILD), {recursive: true})
      fs.chmodSync(locked, 0o555)

      let result: Awaited<ReturnType<typeof run>>

      try {
        result = await run(
          ['uninstall', 'chrome,firefox', '--output', 'json'],
          {
            EXT_BROWSERS_CACHE_DIR: cacheRoot
          }
        )
      } finally {
        fs.chmodSync(locked, 0o755)
      }

      expect(result.status).toBe(1)
      const frame = JSON.parse(result.stdout) as Record<string, unknown>
      expect(frame).toMatchObject({
        schema: 1,
        ok: false,
        command: 'uninstall',
        status: 'failed'
      })

      const error = frame.error as {code: string; message: string}
      expect(error.code).toBe('E_BROWSER_UNINSTALL')
      expect(error.message).toMatch(/^Couldn't remove Chrome\. /)
      expect(error.message).toContain(
        `${path.join(cacheRoot, 'chrome')} is still there (`
      )

      const value = frame.value as {
        results: Array<{browser: string; outcome: string; reason?: string}>
      }
      expect(
        value.results.map((entry) => [entry.browser, entry.outcome])
      ).toEqual([
        ['chrome', 'failed'],
        ['firefox', 'removed']
      ])

      expect(value.results[0].reason).toMatch(/^E[A-Z]+\b/)
      expect(error.message).toContain(String(value.results[0].reason))
      expect(fs.existsSync(path.join(locked, 'chrome'))).toBe(true)
      expect(fs.existsSync(path.join(cacheRoot, 'firefox'))).toBe(false)
    }
  )

  // The chrome folder of an application folder is a browser profile. Built
  // from nothing here, and nothing in it may change.
  it('leaves a folder that holds a browser profile alone under --all, and exits 1', async () => {
    const profile = path.join(cacheRoot, 'chrome')
    fs.rmSync(path.join(profile, BUILD), {recursive: true})
    fs.mkdirSync(path.join(profile, 'Default'))
    fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), '{"a":1}')
    fs.writeFileSync(path.join(profile, 'Local State'), '{"b":2}')
    fs.mkdirSync(path.join(cacheRoot, 'firefox', BUILD), {recursive: true})

    const result = await run(['uninstall', '--all', '--output', 'json'], {
      EXT_BROWSERS_CACHE_DIR: cacheRoot
    })

    expect(result.status).toBe(1)
    const frame = JSON.parse(result.stdout) as Record<string, unknown>
    const error = frame.error as {code: string; message: string}
    const value = frame.value as {
      results: Array<{browser: string; outcome: string; reason?: string}>
    }

    expect(error.code).toBe('E_BROWSER_UNINSTALL')
    expect(error.message).toBe(
      `Couldn't remove Chrome. ${profile} was left untouched ` +
        "(it holds files Extension.js didn't put there). Extension.js " +
        'removes only the folders it installed, so delete that one yourself ' +
        'if you mean to.'
    )

    expect(
      value.results.map((entry) => [entry.browser, entry.outcome])
    ).toEqual([
      ['chrome', 'failed'],
      ['chromium', 'absent'],
      ['edge', 'absent'],
      ['firefox', 'removed']
    ])

    expect(fs.readdirSync(cacheRoot)).toEqual(['chrome'])
    expect(fs.readdirSync(profile).sort()).toEqual(['Default', 'Local State'])
    expect(
      fs.readFileSync(path.join(profile, 'Default', 'Preferences'), 'utf8')
    ).toBe('{"a":1}')

    expect(fs.readFileSync(path.join(profile, 'Local State'), 'utf8')).toBe(
      '{"b":2}'
    )
  })

  it('reports per-target outcomes under --all', async () => {
    const result = await run(['uninstall', '--all', '--output', 'json'], {
      EXT_BROWSERS_CACHE_DIR: cacheRoot
    })

    expect(result.status).toBe(0)
    const frame = JSON.parse(result.stdout) as Record<string, unknown>
    expect(frame.status).toBe('uninstalled')
    expect(frame.warnings).toEqual([])

    const value = frame.value as {
      all: boolean
      results: Array<{browser: string; removed: boolean}>
    }
    expect(value.all).toBe(true)
    expect(value.results).toEqual([
      {
        browser: 'chrome',
        removed: true,
        path: expect.any(String),
        outcome: 'removed'
      },
      {
        browser: 'chromium',
        removed: false,
        path: expect.any(String),
        outcome: 'absent'
      },
      {
        browser: 'edge',
        removed: false,
        path: expect.any(String),
        outcome: 'absent'
      },
      {
        browser: 'firefox',
        removed: false,
        path: expect.any(String),
        outcome: 'absent'
      }
    ])
  })
})

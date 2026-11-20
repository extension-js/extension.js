import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {createTelemetryKit, Telemetry, type TelemetryEnv} from '../telemetry'
import {
  blockFolder,
  cliRun,
  fsWith,
  readRows,
  type Sandbox,
  useTelemetrySandbox
} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

const HOME = path.join(path.sep, 'h')
const TMP = path.join(path.sep, 't')

function candidates(platform: NodeJS.Platform, env: TelemetryEnv): string[] {
  return createTelemetryKit({
    env,
    platform,
    homedir: () => HOME,
    tmpdir: () => TMP
  }).deps.storageFolders()
}

// The temp folder is the last one. The project folder is never tried.
const LAST = path.join(TMP, 'extensionjs')

describe('where telemetry may keep its files, in order', () => {
  it.each<[string, NodeJS.Platform, TelemetryEnv, string[]]>([
    [
      'linux with nothing set',
      'linux',
      {},
      [path.join(HOME, '.config', 'extensionjs'), LAST]
    ],
    [
      'linux with both XDG homes',
      'linux',
      {XDG_CONFIG_HOME: '/c', XDG_CACHE_HOME: '/k'},
      [path.join('/c', 'extensionjs'), path.join('/k', 'extensionjs'), LAST]
    ],
    [
      'macOS with nothing set',
      'darwin',
      {},
      [
        path.join(HOME, '.config', 'extensionjs'),
        path.join(HOME, 'Library', 'Caches', 'extensionjs'),
        LAST
      ]
    ],
    [
      'Windows with APPDATA and LOCALAPPDATA',
      'win32',
      {APPDATA: '/roaming', LOCALAPPDATA: '/local'},
      [
        path.join('/roaming', 'extensionjs'),
        path.join('/local', 'extensionjs', 'Cache'),
        LAST
      ]
    ],
    [
      'Windows with APPDATA alone',
      'win32',
      {APPDATA: '/roaming'},
      [
        path.join('/roaming', 'extensionjs'),
        path.join('/roaming', 'extensionjs', 'Cache'),
        LAST
      ]
    ],
    [
      'Windows with neither',
      'win32',
      {},
      [path.join(HOME, '.config', 'extensionjs'), LAST]
    ],
    [
      'XDG over APPDATA on Windows',
      'win32',
      {XDG_CONFIG_HOME: '/c', APPDATA: '/roaming'},
      [
        path.join('/c', 'extensionjs'),
        path.join('/roaming', 'extensionjs', 'Cache'),
        LAST
      ]
    ],
    [
      'one folder named twice once',
      'linux',
      {XDG_CONFIG_HOME: '/same', XDG_CACHE_HOME: '/same'},
      [path.join('/same', 'extensionjs'), LAST]
    ]
  ])('%s', (_name, platform, env, expected) => {
    expect(candidates(platform, env)).toEqual(expected)
  })
})

function storageIn(box: Sandbox) {
  return box.kit().resolveStorage()
}

describe('an unwritable folder hands over to the next, in turn', () => {
  it('uses the config home first and removes its write probe', () => {
    const box = sandbox()
    const storage = storageIn(box)

    expect(storage).toEqual({
      telemetryDir: box.configDir,
      auditFile: path.join(box.configDir, 'events.jsonl'),
      idFile: path.join(box.configDir, 'anonymous-id'),
      consentFile: path.join(box.configDir, 'consent'),
      noticeFile: path.join(box.configDir, 'notice-shown')
    })

    expect(fs.readdirSync(box.configDir)).toEqual([])
  })

  it('falls to the cache home when the config home is a file', () => {
    const box = sandbox()
    blockFolder(box.places.config)

    expect(storageIn(box)?.telemetryDir).toBe(box.cacheDir)
    expect(fs.readFileSync(box.places.config, 'utf8')).toBe('not a folder')
  })

  it('falls to the temp folder when the cache home is a file too', () => {
    const box = sandbox()
    blockFolder(box.places.config)
    blockFolder(box.places.cache)

    expect(storageIn(box)?.telemetryDir).toBe(
      path.join(box.places.tmp, 'extensionjs', 'telemetry')
    )
  })

  it('has no storage when all three are files', () => {
    const box = sandbox()
    blockFolder(box.places.config)
    blockFolder(box.places.cache)
    blockFolder(path.join(box.places.tmp, 'extensionjs'))

    expect(storageIn(box)).toBeNull()
  })

  it('skips a folder whose write probe is refused', () => {
    const box = sandbox({
      deps: {
        fs: fsWith({
          writeFileSync: (file: string, ...rest: unknown[]) => {
            if (String(file).includes(`${path.sep}config${path.sep}`)) {
              throw Object.assign(new Error('EROFS'), {code: 'EROFS'})
            }

            return (fs.writeFileSync as (...a: unknown[]) => void)(
              file,
              ...rest
            )
          }
        })
      }
    })

    expect(storageIn(box)?.telemetryDir).toBe(box.cacheDir)
    expect(fs.readdirSync(box.configDir)).toEqual([])
  })

  it('skips a folder the access check refuses', () => {
    const box = sandbox({
      deps: {
        fs: fsWith({
          accessSync: (file: string) => {
            if (String(file).startsWith(box.configDir)) {
              throw Object.assign(new Error('EACCES'), {code: 'EACCES'})
            }
          }
        })
      }
    })

    expect(storageIn(box)?.telemetryDir).toBe(box.cacheDir)
  })

  it('tries the injected folders and nothing else', () => {
    const box = sandbox()
    const only = path.join(box.root, 'only')
    const kit = createTelemetryKit({...box.deps, storageFolders: () => [only]})

    expect(kit.resolveStorage()?.telemetryDir).toBe(
      path.join(only, 'telemetry')
    )

    expect(fs.existsSync(box.places.config)).toBe(false)
  })
})

describe('resolving consent on a pipeline', () => {
  it('creates no telemetry folder when the CI gate answers', () => {
    const box = sandbox({env: {CI: '1'}})

    expect(box.kit().resolveConsent(['node', 'extension', 'build'])).toEqual({
      enabled: false,
      source: 'ci'
    })

    expect(fs.existsSync(box.places.config)).toBe(false)
    expect(fs.existsSync(box.places.cache)).toBe(false)
    expect(fs.existsSync(path.join(box.places.tmp, 'extensionjs'))).toBe(false)
  })

  it('still honors a stored refusal on a pipeline, and reports it as config', () => {
    const box = sandbox({env: {CI: '1'}})
    fs.mkdirSync(box.configDir, {recursive: true})
    fs.writeFileSync(path.join(box.configDir, 'consent'), 'disabled')

    expect(box.kit().resolveConsent(['node', 'extension', 'build'])).toEqual({
      enabled: false,
      source: 'config'
    })

    expect(fs.readdirSync(box.configDir)).toEqual(['consent'])
  })

  it.each([
    ['EXTENSION_TELEMETRY=0', {EXTENSION_TELEMETRY: '0'}, []],
    ['DO_NOT_TRACK=1', {DO_NOT_TRACK: '1'}, []],
    ['EXTENSION_TELEMETRY_DISABLED=1', {EXTENSION_TELEMETRY_DISABLED: '1'}, []],
    ['EXTENSION_TELEMETRY=1', {EXTENSION_TELEMETRY: '1'}, []],
    ['--no-telemetry', {}, ['--no-telemetry']]
  ])('writes nothing when %s already answered', (_name, env, argv) => {
    const box = sandbox({env})

    box.kit().resolveConsent(argv)

    expect(fs.existsSync(box.places.config)).toBe(false)
    expect(fs.existsSync(box.places.cache)).toBe(false)
  })
})

describe('writing consent and the notice marker', () => {
  it('writes the consent word into the storage it resolved', () => {
    const box = sandbox()

    expect(box.kit().writeConsent('disabled')).toBe(true)
    expect(fs.readFileSync(path.join(box.configDir, 'consent'), 'utf8')).toBe(
      'disabled'
    )
  })

  it('answers false with no storage at all', () => {
    const box = sandbox({deps: {storageFolders: () => []}})

    expect(box.kit().writeConsent('enabled')).toBe(false)
    expect(box.kit().claimFirstRunNotice()).toBe(false)
  })

  it('answers false when the consent file cannot be written', () => {
    const box = sandbox()
    fs.mkdirSync(path.join(box.configDir, 'consent'), {recursive: true})

    expect(box.kit().writeConsent('enabled')).toBe(false)
  })

  it('claims the notice once, stamped by the clock, and stores enabled', () => {
    const box = sandbox()
    const kit = box.kit()

    expect(kit.claimFirstRunNotice()).toBe(true)
    expect(kit.claimFirstRunNotice()).toBe(false)
    expect(
      fs.readFileSync(path.join(box.configDir, 'notice-shown'), 'utf8')
    ).toBe('2026-11-17T12:00:00.000Z')

    expect(fs.readFileSync(path.join(box.configDir, 'consent'), 'utf8')).toBe(
      'enabled'
    )
  })

  it('does not claim a notice whose marker path is taken by a folder', () => {
    const box = sandbox()
    fs.mkdirSync(path.join(box.configDir, 'notice-shown'), {recursive: true})

    expect(box.kit().claimFirstRunNotice()).toBe(false)
    expect(fs.existsSync(path.join(box.configDir, 'consent'))).toBe(false)
  })

  it('does not claim a notice whose marker write fails', () => {
    const box = sandbox({
      deps: {
        fs: fsWith({
          writeFileSync: (file: string, ...rest: unknown[]) => {
            if (String(file).endsWith('notice-shown')) throw new Error('ENOSPC')

            return (fs.writeFileSync as (...a: unknown[]) => void)(
              file,
              ...rest
            )
          }
        })
      }
    })

    expect(box.kit().claimFirstRunNotice()).toBe(false)
    // The consent word went first, so it stays written.
    expect(fs.readFileSync(path.join(box.configDir, 'consent'), 'utf8')).toBe(
      'enabled'
    )
  })

  it('does not claim a notice when the marker check throws', () => {
    const box = sandbox({
      deps: {
        fs: fsWith({
          existsSync: (file: string) => {
            if (String(file).endsWith('notice-shown')) throw new Error('EIO')

            return fs.existsSync(file)
          }
        })
      }
    })

    expect(box.kit().claimFirstRunNotice()).toBe(false)
    expect(fs.existsSync(path.join(box.configDir, 'consent'))).toBe(false)
  })
})

describe('with no writable storage at all', () => {
  it('turns the run off: no audit line, nothing sent, no file written', async () => {
    const box = sandbox({deps: {storageFolders: () => []}})
    const telemetry = box.telemetry({sampleRate: 1, debounceMs: 0})

    telemetry.track('command_executed', {
      command: 'test',
      success: true,
      version: '0.0.0'
    })

    await telemetry.flush()

    expect(telemetry.isEnabled).toBe(false)
    expect(telemetry.flushSync(1000)).toBe(false)
    expect(box.sent).toEqual([])
    expect(box.crashSent).toEqual([])
    expect(fs.readdirSync(box.root).sort()).toEqual(['home', 'project', 'tmp'])
  })

  it('answers off by storage, even to an opt-in by variable', () => {
    const box = sandbox({deps: {storageFolders: () => []}})

    expect(box.kit().resolveConsent(['node', 'extension', 'build'])).toEqual({
      enabled: false,
      source: 'storage'
    })

    const optedIn = cliRun(
      sandbox({
        env: {EXTENSION_TELEMETRY: '1'},
        deps: {storageFolders: () => []}
      })
    )

    expect(optedIn.cli.telemetry.isEnabled).toBe(false)
    expect(optedIn.cli.getStatus()).toEqual({
      enabled: false,
      source: 'storage',
      anonymousId: null,
      consentFile: null,
      auditFile: null
    })
  })

  // Permission bits do not refuse a write on Windows or to root.
  const canRefuseWrites =
    process.platform !== 'win32' && process.getuid?.() !== 0

  it.skipIf(!canRefuseWrites)(
    'never falls back to the project when home, cache and temp are read-only',
    async () => {
      const box = sandbox()
      const readOnly = [box.places.home, box.places.tmp]
      // The kit's own candidates, on the real fs, from inside the project.
      const kit = createTelemetryKit({
        env: {POSTHOG_HOST: 'http://127.0.0.1:9'},
        platform: 'darwin',
        homedir: () => box.places.home,
        tmpdir: () => box.places.tmp,
        isCI: () => false,
        send: box.deps.send,
        sendSync: box.deps.sendSync
      })
      const startedIn = process.cwd()

      for (const folder of readOnly) fs.chmodSync(folder, 0o555)
      process.chdir(box.places.project)

      try {
        expect(kit.deps.storageFolders()).toEqual([
          path.join(box.places.home, '.config', 'extensionjs'),
          path.join(box.places.home, 'Library', 'Caches', 'extensionjs'),
          path.join(box.places.tmp, 'extensionjs')
        ])

        expect(kit.resolveStorage()).toBeNull()
        expect(kit.resolveConsent(['node', 'extension', 'build'])).toEqual({
          enabled: false,
          source: 'storage'
        })

        const telemetry = new Telemetry(
          {app: 'extension', version: '9.9.9', sampleRate: 1},
          kit
        )

        telemetry.track('command_failed', {
          command: 'build',
          success: false,
          version: '9.9.9'
        })

        await telemetry.flush()

        expect(telemetry.isEnabled).toBe(false)
        expect(box.sent).toEqual([])
        expect(kit.writeConsent('disabled')).toBe(false)
        expect(kit.claimFirstRunNotice()).toBe(false)

        for (const folder of [...readOnly, box.places.project]) {
          expect(fs.readdirSync(folder)).toEqual([])
        }
      } finally {
        process.chdir(startedIn)

        for (const folder of readOnly) fs.chmodSync(folder, 0o755)
      }
    }
  )

  it('keeps auditing in the cache home when the config home is a file', () => {
    const box = sandbox()
    blockFolder(box.places.config)

    box.telemetry({sampleRate: 1, debounceMs: 0}).track('command_executed', {
      command: 'test',
      success: true,
      version: '0.0.0'
    })

    expect(
      readRows(path.join(box.cacheDir, 'events.jsonl')).map(
        (row) => `${row.event}:${row.properties.command}`
      )
    ).toEqual(['command_executed:test'])
  })
})

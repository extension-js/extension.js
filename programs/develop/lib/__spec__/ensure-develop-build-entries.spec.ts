import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {stripVTControlCharacters} from 'node:util'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const execInstallCommand = vi.fn()

vi.mock('../package-manager', async (importOriginal) => {
  const actual = (await importOriginal()) as any

  return {
    ...actual,
    execInstallCommand: (...args: any[]) => execInstallCommand(...args),
    resolvePackageManager: () => ({name: 'pnpm'})
  }
})

import buildConfig from '../../rslib.config'
import {
  DEVELOP_BUILD_ENTRIES,
  developBuildEntryFile,
  developWatchLockDir
} from '../develop-build-entries'
import {ensureDevelopArtifacts} from '../ensure-develop-artifacts'

const OLD_ALIASES = ['ensure-hmr-for-scripts.js', 'minimum-script-file.js']
const LOADER = 'late-css-import-loader'
const savedEnv = {
  EXTENSION_DEVELOP_ROOT: process.env.EXTENSION_DEVELOP_ROOT,
  EXTENSION_DEBUG: process.env.EXTENSION_DEBUG,
  EXTENSION_AUTHOR_MODE: process.env.EXTENSION_AUTHOR_MODE
}

let root: string

function writeEntry(entry: string) {
  fs.writeFileSync(developBuildEntryFile(root, entry), '')
}

// A dist with every entry but the named ones, plus the two files the old
// check looked at, so a partial build is the only thing that differs.
function makeDevelopRoot(options: {
  source: boolean
  without?: string[]
  aliases?: boolean
}) {
  fs.mkdirSync(path.join(root, 'dist'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'extension-develop'})
  )

  if (options.source) fs.writeFileSync(path.join(root, 'rslib.config.ts'), '')

  if (options.aliases !== false) {
    for (const alias of OLD_ALIASES) {
      fs.writeFileSync(path.join(root, 'dist', alias), '')
    }
  }

  for (const entry of DEVELOP_BUILD_ENTRIES) {
    if (!options.without?.includes(entry)) writeEntry(entry)
  }
}

// The watch script's lock, as the lock wrapper writes it for a holder.
function holdWatchLock(pid: number) {
  const lockDir = developWatchLockDir(root)

  fs.mkdirSync(lockDir, {recursive: true})
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({pid}))
}

function exitedPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid
}

async function refusal(
  options?: Parameters<typeof ensureDevelopArtifacts>[0]
): Promise<{code?: string; lines: string[]}> {
  const error: any = await ensureDevelopArtifacts(options).catch(
    (caught) => caught
  )

  return {
    code: error?.code,
    lines: stripVTControlCharacters(String(error?.message ?? '')).split('\n')
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'develop-entries-'))
  )

  process.env.EXTENSION_DEVELOP_ROOT = root
  Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
  Reflect.deleteProperty(process.env, 'EXTENSION_AUTHOR_MODE')
})

afterEach(() => {
  fs.rmSync(root, {recursive: true, force: true})

  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
})

describe('the develop build entry list', () => {
  it('names exactly the entries the build config emits', () => {
    const emitted = (buildConfig.lib ?? []).flatMap((lib) =>
      Object.keys((lib.source?.entry ?? {}) as Record<string, unknown>)
    )

    expect(emitted.length).toBeGreaterThan(0)
    expect([...DEVELOP_BUILD_ENTRIES].sort()).toEqual([...emitted].sort())
  })

  it('reads the file the build writes for each entry', () => {
    const names = (buildConfig.lib ?? []).map(
      (lib) => (lib.output?.filename as {js?: string} | undefined)?.js
    )

    expect(new Set(names)).toEqual(new Set(['[name].mjs']))
    expect(developBuildEntryFile('/develop', 'module')).toBe(
      path.join('/develop', 'dist', 'module.mjs')
    )
  })
})

describe('ensureDevelopArtifacts', () => {
  it('starts without a rebuild when every entry is on disk', async () => {
    makeDevelopRoot({source: true})

    await ensureDevelopArtifacts()

    expect(execInstallCommand).not.toHaveBeenCalled()
  })

  it('refuses an installed copy that lost a loader and names the file', async () => {
    makeDevelopRoot({source: false, without: [LOADER]})

    const {code, lines} = await refusal()

    expect(execInstallCommand).not.toHaveBeenCalled()
    expect(code).toBe('E_INTERNAL')
    expect(lines).toEqual([
      '⏵⏵⏵ Error: Extension.js is missing 1 of its own build files.',
      `  ${developBuildEntryFile(root, LOADER)}`,
      'Reinstall extension, then run the command again.'
    ])
  })

  it('lists five missing files and counts the rest', async () => {
    makeDevelopRoot({source: false, without: [...DEVELOP_BUILD_ENTRIES]})

    const {lines} = await refusal()

    expect(lines[0]).toBe(
      `⏵⏵⏵ Error: Extension.js is missing ${DEVELOP_BUILD_ENTRIES.length} of its own build files.`
    )

    expect(lines.slice(1, 6)).toEqual(
      DEVELOP_BUILD_ENTRIES.slice(0, 5).map(
        (entry) => `  ${developBuildEntryFile(root, entry)}`
      )
    )

    expect(lines[6]).toBe(`  and ${DEVELOP_BUILD_ENTRIES.length - 5} more`)
  })

  it('rebuilds a source checkout that lost a loader, quietly', async () => {
    makeDevelopRoot({source: true, without: [LOADER]})
    execInstallCommand.mockImplementation(async () => writeEntry(LOADER))

    await ensureDevelopArtifacts()

    expect(execInstallCommand).toHaveBeenCalledTimes(1)
    expect(execInstallCommand).toHaveBeenCalledWith(
      'pnpm',
      ['run', 'compile'],
      {cwd: root, stdio: 'ignore'}
    )

    expect(console.warn).not.toHaveBeenCalled()
  })

  it('shows the rebuild to an author', async () => {
    process.env.EXTENSION_DEBUG = '1'
    makeDevelopRoot({source: true, without: [LOADER]})
    execInstallCommand.mockImplementation(async () => writeEntry(LOADER))

    await ensureDevelopArtifacts()

    expect(execInstallCommand.mock.calls[0][2]).toEqual({
      cwd: root,
      stdio: 'inherit'
    })

    expect(
      stripVTControlCharacters(String((console.warn as any).mock.calls[0][0]))
    ).toContain('install  target=extension-develop build artifacts')
  })

  it.each([
    ['exits clean without the file', async () => {}],
    [
      'fails',
      async () => {
        throw new Error('Install failed with exit code 1')
      }
    ]
  ])('names the file when the rebuild %s', async (_label, rebuild) => {
    makeDevelopRoot({source: true, without: [LOADER]})
    execInstallCommand.mockImplementation(rebuild)

    const {code, lines} = await refusal()

    expect(execInstallCommand).toHaveBeenCalledTimes(1)
    expect(code).toBe('E_INTERNAL')
    expect(lines).toEqual([
      '⏵⏵⏵ Error: Extension.js is missing 1 of its own build files and could not rebuild.',
      `  ${developBuildEntryFile(root, LOADER)}`,
      `Run pnpm run compile in ${root} to see the build error.`
    ])
  })
})

describe('ensureDevelopArtifacts beside the watch build', () => {
  it('starts on a dist only the watch wrote, without a compile', async () => {
    makeDevelopRoot({source: true, aliases: false})

    await ensureDevelopArtifacts()

    expect(execInstallCommand).not.toHaveBeenCalled()
  })

  it('reads the lock the watch script takes', async () => {
    const wrapper = path.resolve(
      __dirname,
      '../../../../scripts/run-locked.mjs'
    )
    const {lockDirFor} = await import(pathToFileURL(wrapper).href)
    const scripts = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
    ).scripts

    expect(scripts.watch).toMatch(
      /^node \.\.\/\.\.\/scripts\/run-locked\.mjs watch /
    )

    expect(developWatchLockDir(root)).toBe(lockDirFor(root, 'watch'))
  })

  it('waits for a running watch to write the file and spawns no compile', async () => {
    makeDevelopRoot({source: true, aliases: false, without: [LOADER]})
    holdWatchLock(process.pid)
    setTimeout(() => writeEntry(LOADER), 60)

    await ensureDevelopArtifacts({watchWaitMs: 5000, watchPollMs: 10})

    expect(execInstallCommand).not.toHaveBeenCalled()
  })

  it('names the file a running watch never wrote and spawns no compile', async () => {
    makeDevelopRoot({source: true, aliases: false, without: [LOADER]})
    holdWatchLock(process.pid)

    const {code, lines} = await refusal({watchWaitMs: 40, watchPollMs: 10})

    expect(execInstallCommand).not.toHaveBeenCalled()
    expect(code).toBe('E_INTERNAL')
    expect(lines).toEqual([
      '⏵⏵⏵ Error: Extension.js is missing 1 of its own build files and the running watch build did not write them.',
      `  ${developBuildEntryFile(root, LOADER)}`,
      'Fix the build error the watch prints, then run the command again.'
    ])
  })

  it('rebuilds when the watch lock belongs to a process that exited', async () => {
    makeDevelopRoot({source: true, aliases: false, without: [LOADER]})
    holdWatchLock(exitedPid())
    execInstallCommand.mockImplementation(async () => writeEntry(LOADER))

    await ensureDevelopArtifacts({watchWaitMs: 40, watchPollMs: 10})

    expect(execInstallCommand).toHaveBeenCalledTimes(1)
  })
})

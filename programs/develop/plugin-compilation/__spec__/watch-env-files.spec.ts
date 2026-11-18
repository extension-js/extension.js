import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  bindDevSessionRestart,
  type DevSessionRestartRequest,
  DevSessionRestartScheduler,
  unbindDevSessionRestart
} from '../../dev-server/session-restart'
import {EnvPlugin} from '../env'
import {WatchEnvFilesPlugin} from '../watch-env-files'
import {
  createCompiler,
  makeTempRoot,
  removeTempRoots,
  runCompiler,
  runScript,
  writeFiles
} from './helpers/real-compile'

type Compilation = {
  warnings: Array<Error & {name?: string}>
  errors: Array<Error>
  fileDependencies: Set<string>
  missingDependencies: Set<string>
  hooks: {
    processAssets: {tap: () => void; tapPromise: () => void}
  }
}

function createCompilation(): Compilation {
  return {
    warnings: [],
    errors: [],
    fileDependencies: new Set<string>(),
    missingDependencies: new Set<string>(),
    hooks: {processAssets: {tap: () => {}, tapPromise: () => {}}}
  }
}

function createFakeCompiler(projectRoot: string, watch = true) {
  const watchRun: Array<() => void> = []
  const thisCompilation: Array<(c: Compilation) => void> = []
  const noop = {tap: () => {}}

  return {
    options: {
      mode: 'development',
      watchOptions: watch ? {} : undefined,
      context: projectRoot,
      output: {environment: {}}
    },
    __internal__registerBuiltinPlugin: () => {},
    hooks: {
      watchRun: {tap: (_n: string, cb: () => void) => watchRun.push(cb)},
      thisCompilation: {
        tap: (_n: string, cb: (c: Compilation) => void) =>
          thisCompilation.push(cb)
      },
      done: noop,
      watchClose: noop,
      compilation: noop
    },
    modifiedFiles: new Set<string>(),
    removedFiles: new Set<string>(),
    __cycle(compilation: Compilation) {
      for (const cb of watchRun) cb()
      for (const cb of thisCompilation) cb(compilation)
    }
  }
}

const tempDirs = new Set<string>()

function createProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extensionjs-env-watch-'))
  tempDirs.add(dir)
  fs.mkdirSync(path.join(dir, 'src'), {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'src/manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'p', version: '1.0'})
  )

  fs.writeFileSync(
    path.join(dir, '.env.chromium'),
    'EXTENSION_PUBLIC_GREETING="first"\n'
  )

  return dir
}

let requests: DevSessionRestartRequest[]

beforeEach(() => {
  requests = []
  vi.clearAllMocks()
})

afterEach(() => {
  unbindDevSessionRestart()

  for (const dir of tempDirs) {
    fs.rmSync(dir, {recursive: true, force: true})
  }

  tempDirs.clear()
  removeTempRoots()
})

function bindScheduler() {
  const scheduler = new DevSessionRestartScheduler(0)
  scheduler.setHandler((request) => {
    requests.push(request)
  })

  bindDevSessionRestart(scheduler)

  return scheduler
}

describe('WatchEnvFilesPlugin', () => {
  it('asks the session to restart when a watched env file changes', async () => {
    const projectRoot = createProject()
    const envPath = path.join(projectRoot, '.env.chromium')
    bindScheduler()

    const compiler = createFakeCompiler(projectRoot)
    new WatchEnvFilesPlugin([envPath]).apply(compiler as never)

    compiler.__cycle(createCompilation())
    compiler.modifiedFiles = new Set([envPath])

    const compilation = createCompilation()
    compiler.__cycle(compilation)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(requests).toHaveLength(1)
    expect(requests[0].reason).toBe('env')
    expect(requests[0].pathChanged).toBe(envPath)
    // The session carries the change, so there is nothing left to warn about.
    expect(compilation.warnings).toEqual([])
  })

  it('warns instead when no session can restart', () => {
    const projectRoot = createProject()
    const envPath = path.join(projectRoot, '.env.chromium')

    const compiler = createFakeCompiler(projectRoot)
    new WatchEnvFilesPlugin([envPath]).apply(compiler as never)

    compiler.modifiedFiles = new Set([envPath])

    const compilation = createCompilation()
    compiler.__cycle(compilation)

    expect(compilation.warnings).toHaveLength(1)
    expect(compilation.warnings[0].name).toBe('EnvFileChange')
    expect(String(compilation.warnings[0].message)).toContain('.env.chromium')
  })

  it('ignores a change to a file it does not read', () => {
    const projectRoot = createProject()
    bindScheduler()

    const compiler = createFakeCompiler(projectRoot)
    new WatchEnvFilesPlugin([path.join(projectRoot, '.env.chromium')]).apply(
      compiler as never
    )

    compiler.modifiedFiles = new Set([path.join(projectRoot, 'src/other.ts')])

    const compilation = createCompilation()
    compiler.__cycle(compilation)

    expect(requests).toEqual([])
    expect(compilation.warnings).toEqual([])
  })
})

describe('the env plugin wiring', () => {
  it('watches the env files a dev session resolved from', async () => {
    const projectRoot = createProject()
    const envPath = path.join(projectRoot, '.env.chromium')
    bindScheduler()

    const compiler = createFakeCompiler(projectRoot)
    new EnvPlugin({
      manifestPath: path.join(projectRoot, 'src/manifest.json'),
      browser: 'chromium'
    }).apply(compiler as never)

    const first = createCompilation()
    compiler.__cycle(first)
    expect([...first.fileDependencies]).toContain(envPath)

    compiler.modifiedFiles = new Set([envPath])
    compiler.__cycle(createCompilation())
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(requests.map((request) => request.reason)).toContain('env')
  })

  it('leaves a one-shot build alone', () => {
    const projectRoot = createProject()
    const compiler = createFakeCompiler(projectRoot, false)
    new EnvPlugin({
      manifestPath: path.join(projectRoot, 'src/manifest.json'),
      browser: 'chromium'
    }).apply(compiler as never)

    const compilation = createCompilation()
    compiler.__cycle(compilation)

    expect([...compilation.fileDependencies]).toEqual([])
  })
})

describe('an env file edited under a real watch', () => {
  const READ_GREETING =
    "const key = 'EXTENSION_PUBLIC_GREETING'\nconsole.log(process.env.EXTENSION_PUBLIC_GREETING, process.env[key], import.meta.env[key])\n"

  function compilerFor(root: string) {
    return createCompiler({
      context: root,
      outputPath: path.join(root, 'out'),
      entry: {entry: './entry.js'},
      plugins: [new EnvPlugin({browser: 'chromium'})]
    })
  }

  async function until(check: () => boolean): Promise<void> {
    const giveUpAt = Date.now() + 20000

    while (!check() && Date.now() < giveUpAt) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  it('asks for a restart, and the compiler a restart builds reads the new value', async () => {
    const root = makeTempRoot('env-watch')
    const envPath = path.join(root, '.env.chromium')
    const output = path.join(root, 'out', 'entry.js')
    writeFiles(root, {
      '.env.chromium': 'EXTENSION_PUBLIC_GREETING=first\n',
      'entry.js': READ_GREETING
    })

    bindScheduler()

    let builds = 0
    const running = compilerFor(root)
    running.hooks.done.tap('spec', () => {
      builds++
    })

    const watching = running.watch({aggregateTimeout: 20}, () => {})

    try {
      await until(() => builds > 0)
      expect(runScript(output)).toEqual(['first first first'])

      const seen = builds
      fs.writeFileSync(envPath, 'EXTENSION_PUBLIC_GREETING=second\n')
      await until(() => requests.length > 0 && builds > seen)

      expect(requests.map((request) => request.reason)).toEqual(['env'])
      expect(requests[0].pathChanged).toBe(envPath)
      // The running compiler read the file once, so its rebuild is stale.
      expect(runScript(output)).toEqual(['first first first'])
    } finally {
      await new Promise<void>((resolve) => watching.close(() => resolve()))
      await new Promise<void>((resolve) => running.close(() => resolve()))
    }

    await runCompiler(compilerFor(root))
    expect(runScript(output)).toEqual(['second second second'])
  })
})

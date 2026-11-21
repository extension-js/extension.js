import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  bindDevSessionRestart,
  DevSessionRestartScheduler,
  unbindDevSessionRestart
} from '../../dev-server/session-restart'
import {rememberSpecialFoldersConfig} from '../../lib/special-folders/folders-config'
import {WarnUponFolderChanges} from '../warn-upon-folder-changes'

const ESC = String.fromCharCode(27)
const plain = (text: unknown) =>
  String(text).replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')

// The facts a restart notice must carry: what changed, in which folder, and
// that the dev server needs a restart.
function expectRestartNotice(
  issue: {message?: unknown; name?: unknown; file?: unknown} | undefined,
  verb: 'Adding' | 'Removing',
  kind: 'HTML pages' | 'script files',
  folder: 'pages' | 'scripts',
  file: string
) {
  const text = plain(issue?.message)
  expect(text).toContain(
    `${verb} ${kind} in ${folder}/ changes the extension entrypoints.`
  )

  expect(text).toContain('Restart the dev server to apply the change.')
  expect(issue?.name).toBe(
    verb === 'Adding' ? 'SpecialFoldersChange' : 'SpecialFoldersRemoval'
  )

  expect(issue?.file).toBe(file)
}

const createFakeCompiler = () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extensionjs-special-folders-')
  )
  const watchRunCallbacks: Array<() => void> = []
  const doneCallbacks: Array<(stats: any) => void> = []
  const thisCompilationCallbacks: Array<(c: any) => void> = []
  const hooks: any = {
    watchRun: {
      tap: (_name: string, callback: () => void) => {
        watchRunCallbacks.push(callback)
      },
      __invokeAll: () => {
        for (const cb of watchRunCallbacks) cb()
      }
    },
    done: {
      tap: (_name: unknown, callback: (stats: any) => void) => {
        doneCallbacks.push(callback)
      },
      __invokeAll: (compilationInstance: any) => {
        for (const cb of doneCallbacks) cb({compilation: compilationInstance})
      }
    },
    thisCompilation: {
      tap: (_name: string, callback: (c: any) => void) => {
        thisCompilationCallbacks.push(callback)
      },
      __invokeAll: (compilationInstance: any) => {
        for (const cb of thisCompilationCallbacks) cb(compilationInstance)
      }
    }
  }

  const compiler: any = {
    options: {
      mode: 'development',
      watchOptions: {},
      resolve: {extensions: ['.js', '.ts']},
      context: projectRoot
    },
    hooks,
    watchMode: true,
    modifiedFiles: new Set<string>(),
    removedFiles: new Set<string>()
  }

  return {compiler, projectRoot}
}

const runCycle = (
  compiler: any,
  compilation: {
    warnings: any[]
    errors: any[]
    contextDependencies: Set<string>
    missingDependencies: Set<string>
  }
) => {
  ;(compiler.hooks.watchRun as any).__invokeAll()
  ;(compiler.hooks.thisCompilation as any).__invokeAll(compilation)
}

let compilation: {
  warnings: any[]
  errors: any[]
  contextDependencies: Set<string>
  missingDependencies: Set<string>
}
const tempDirs = new Set<string>()
const toPosix = (value: string) => value.split(path.sep).join('/')

// The scheduler calls the handler at once and frees itself one microtask
// later, so a second request needs that tick to be served.
const restartSettled = () => Promise.resolve()

beforeEach(() => {
  compilation = {
    warnings: [],
    errors: [],
    contextDependencies: new Set(),
    missingDependencies: new Set()
  }

  vi.clearAllMocks()
})

afterEach(() => {
  unbindDevSessionRestart()

  for (const dir of tempDirs) {
    rememberSpecialFoldersConfig(dir, undefined)
    fs.rmSync(dir, {recursive: true, force: true})
  }

  tempDirs.clear()
})

describe('WarnUponFolderChanges', () => {
  it('warns on adding pages/*.html and errors on removing', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'pages'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    const page = path.join(projectRoot, 'pages', 'foo.html')
    compiler.modifiedFiles = new Set([page])

    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)
    expect(compilation.warnings.length).toBe(1)
    expectRestartNotice(
      compilation.warnings[0],
      'Adding',
      'HTML pages',
      'pages',
      page
    )

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([page])

    runCycle(compiler, compilation)
    expect(compilation.errors.length).toBe(1)
    expectRestartNotice(
      compilation.errors[0],
      'Removing',
      'HTML pages',
      'pages',
      page
    )
  })

  it('warns on adding supported scripts and errors on removing; ignores unsupported extensions', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    const script = path.join(projectRoot, 'scripts', 'content.ts')
    compiler.modifiedFiles = new Set([
      script,
      path.join(projectRoot, 'scripts', 'note.md')
    ])

    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)
    expect(compilation.warnings.length).toBe(1)
    expectRestartNotice(
      compilation.warnings[0],
      'Adding',
      'script files',
      'scripts',
      script
    )

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([script])

    runCycle(compiler, compilation)
    expect(compilation.errors.length).toBe(1)
    expectRestartNotice(
      compilation.errors[0],
      'Removing',
      'script files',
      'scripts',
      script
    )
  })

  it('ignores non-HTML additions/removals in pages/', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'pages'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    compiler.modifiedFiles = new Set([
      path.join(projectRoot, 'pages', 'readme.txt')
    ])

    compiler.removedFiles = new Set([
      path.join(projectRoot, 'pages', 'readme.txt')
    ])

    runCycle(compiler, compilation)

    expect(compilation.warnings.length).toBe(0)
    expect(compilation.errors.length).toBe(0)
  })

  it('registers pages/ and scripts/ as context dependencies when they exist', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'pages'), {recursive: true})
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)
    runCycle(compiler, compilation)

    const deps = Array.from(compilation.contextDependencies).map((p) =>
      String(p).replace(/\\/g, '/')
    )
    expect(deps).toContain(path.join(projectRoot, 'pages').replace(/\\/g, '/'))
    expect(deps).toContain(
      path.join(projectRoot, 'scripts').replace(/\\/g, '/')
    )
  })

  it('does NOT warn when editing a preexisting scripts/<file>.js (modification, not addition)', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})
    const existingFile = path.join(projectRoot, 'scripts', 'script-one.js')
    fs.writeFileSync(existingFile, '// pre-existing', 'utf8')

    new WarnUponFolderChanges().apply(compiler as any)

    compiler.modifiedFiles = new Set([existingFile])
    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)

    expect(compilation.warnings.length).toBe(0)
    expect(compilation.errors.length).toBe(0)
  })

  it('still warns when a NEW scripts/<file>.js appears after the snapshot', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})

    new WarnUponFolderChanges().apply(compiler as any)

    const newFile = path.join(projectRoot, 'scripts', 'script-new.js')
    compiler.modifiedFiles = new Set([newFile])
    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)

    expect(compilation.warnings.length).toBe(1)
    expectRestartNotice(
      compilation.warnings[0],
      'Adding',
      'script files',
      'scripts',
      newFile
    )

    compiler.hooks.done.__invokeAll(compilation)
    compilation.warnings.length = 0
    compiler.modifiedFiles = new Set([newFile])
    runCycle(compiler, compilation)
    expect(compilation.warnings.length).toBe(0)
  })

  it('reports an added page again when a second watchRun supersedes the compile', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'pages'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    const page = path.join(projectRoot, 'pages', 'extra.html')
    const superseded = {...compilation, warnings: [], errors: []}
    compiler.modifiedFiles = new Set([page])
    runCycle(compiler, superseded)

    compiler.modifiedFiles = new Set([
      path.join(projectRoot, 'pages', 'other.css')
    ])

    runCycle(compiler, compilation)

    expect(compilation.warnings.length).toBe(1)
    expectRestartNotice(
      compilation.warnings[0],
      'Adding',
      'HTML pages',
      'pages',
      page
    )
  })

  it('drops the noise of a removal a second watchRun inside one compile saw', () => {
    bindRestartHandler()
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'pages'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    const pageScript = path.join(projectRoot, 'pages', 'extra.js')
    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([
      path.join(projectRoot, 'pages', 'extra.html'),
      pageScript
    ])

    runCycle(compiler, {...compilation, warnings: [], errors: []})

    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)

    compilation.errors.push(
      new Error(`Module not found: Can't resolve '${pageScript}'`)
    )

    compiler.hooks.done.__invokeAll(compilation)

    expect(compilation.errors).toEqual([])
  })

  it('watches a missing special folder by its own path, never the project root', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)

    new WarnUponFolderChanges().apply(compiler as any)
    runCycle(compiler, compilation)

    expect(Array.from(compilation.contextDependencies)).toEqual([])
    const missing = Array.from(compilation.missingDependencies).map(toPosix)
    expect(missing).toEqual([
      toPosix(path.join(projectRoot, 'pages')),
      toPosix(path.join(projectRoot, 'scripts'))
    ])
  })

  it('restarts a live session on an addition and on a removal', async () => {
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)

    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    compiler.modifiedFiles = new Set([
      path.join(projectRoot, 'scripts', 'extra.js')
    ])

    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)
    await restartSettled()
    expect(compilation.warnings.length).toBe(0)
    expect(compilation.errors.length).toBe(0)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'scripts',
        pathAfter: path.join(projectRoot, 'scripts', 'extra.js')
      })
    )

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([
      path.join(projectRoot, 'scripts', 'extra.js')
    ])

    runCycle(compiler, compilation)

    await restartSettled()
    expect(compilation.errors.length).toBe(0)
    expect(handler).toHaveBeenLastCalledWith({
      reason: 'scripts',
      pathBefore: path.join(projectRoot, 'scripts', 'extra.js')
    })
  })

  it('restarts a live session once for a rename and names both paths', () => {
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)

    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'pages'), {recursive: true})
    fs.writeFileSync(path.join(projectRoot, 'pages', 'old.html'), '<html>')
    new WarnUponFolderChanges().apply(compiler as any)

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)

    compiler.modifiedFiles = new Set([
      path.join(projectRoot, 'pages', 'new.html')
    ])

    compiler.removedFiles = new Set([
      path.join(projectRoot, 'pages', 'old.html')
    ])

    runCycle(compiler, compilation)

    expect(compilation.errors.length).toBe(0)
    expect(compilation.warnings.length).toBe(0)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      reason: 'html',
      pathBefore: path.join(projectRoot, 'pages', 'old.html'),
      pathAfter: path.join(projectRoot, 'pages', 'new.html')
    })
  })

  it('drops what the superseded build says about a file a restart removes', () => {
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)

    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'pages'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    const page = path.join(projectRoot, 'pages', 'extra.html')
    const pageScript = path.join(projectRoot, 'pages', 'extra.js')

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([page, pageScript])
    runCycle(compiler, compilation)

    const unrelated = new Error("Module not found: Can't resolve './other.js'")

    compilation.errors.push(
      new Error(`Module not found: Can't resolve '${pageScript}'`),
      unrelated
    )

    compilation.warnings.push(
      new Error('Check the pages.extra field in your manifest.json file.')
    )

    compiler.hooks.done.__invokeAll(compilation)

    expect(compilation.errors).toEqual([unrelated])
    expect(compilation.warnings).toEqual([])
  })

  it('still refuses a removal as an error when no session can restart', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([
      path.join(projectRoot, 'scripts', 'extra.js')
    ])

    runCycle(compiler, compilation)
    expect(compilation.errors.length).toBe(1)
    expectRestartNotice(
      compilation.errors[0],
      'Removing',
      'script files',
      'scripts',
      path.join(projectRoot, 'scripts', 'extra.js')
    )

    expect(compilation.errors[0].details).toBe(
      'Removing from scripts/ breaks current build. Restart the dev server to recompile.'
    )
  })

  const bindRestartHandler = () => {
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)

    return handler
  }

  it('restarts for a relocated scripts folder exactly as for the canonical one', async () => {
    const handler = bindRestartHandler()

    for (const [folders, scriptsDir] of [
      [undefined, 'scripts'],
      [{scripts: 'src/scripts'}, path.join('src', 'scripts')]
    ] as const) {
      const {compiler, projectRoot} = createFakeCompiler()
      tempDirs.add(projectRoot)
      rememberSpecialFoldersConfig(projectRoot, folders)
      fs.mkdirSync(path.join(projectRoot, scriptsDir), {recursive: true})
      new WarnUponFolderChanges().apply(compiler as any)
      compilation = {
        warnings: [],
        errors: [],
        contextDependencies: new Set(),
        missingDependencies: new Set()
      }

      const fresh = path.join(projectRoot, scriptsDir, 'fresh.ts')
      compiler.modifiedFiles = new Set([fresh])
      compiler.removedFiles = new Set()
      runCycle(compiler, compilation)
      await restartSettled()

      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({reason: 'scripts', pathAfter: fresh})
      )

      expect(compilation.warnings.length).toBe(0)
      expect(compilation.errors.length).toBe(0)

      const deps = Array.from(compilation.contextDependencies).map(toPosix)
      expect(deps).toContain(toPosix(path.join(projectRoot, scriptsDir)))

      if (folders) {
        expect(deps).not.toContain(toPosix(path.join(projectRoot, 'scripts')))
      }
    }

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('restarts for a relocated pages folder and watches it', () => {
    const handler = bindRestartHandler()
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    rememberSpecialFoldersConfig(projectRoot, {pages: 'src/pages'})
    fs.mkdirSync(path.join(projectRoot, 'src', 'pages'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    const fresh = path.join(projectRoot, 'src', 'pages', 'fresh.html')
    compiler.modifiedFiles = new Set([fresh])
    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({reason: 'html', pathAfter: fresh})
    )

    const deps = Array.from(compilation.contextDependencies).map(toPosix)
    expect(deps).toContain(toPosix(path.join(projectRoot, 'src', 'pages')))
    expect(deps).not.toContain(toPosix(path.join(projectRoot, 'pages')))
  })

  it('does nothing for a folder set to false', () => {
    const handler = bindRestartHandler()
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    rememberSpecialFoldersConfig(projectRoot, {pages: false, scripts: false})
    fs.mkdirSync(path.join(projectRoot, 'pages'), {recursive: true})
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    compiler.modifiedFiles = new Set([
      path.join(projectRoot, 'pages', 'another.html'),
      path.join(projectRoot, 'scripts', 'another.ts')
    ])

    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)

    expect(handler).not.toHaveBeenCalled()
    expect(compilation.warnings.length).toBe(0)
    expect(compilation.errors.length).toBe(0)
    expect(Array.from(compilation.contextDependencies)).toEqual([])

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([
      path.join(projectRoot, 'pages', 'another.html'),
      path.join(projectRoot, 'scripts', 'another.ts')
    ])

    runCycle(compiler, compilation)

    expect(compilation.errors.length).toBe(0)
  })

  it('ignores a scripts/ file the scan never enrolls, on add and on removal', () => {
    const handler = bindRestartHandler()
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    compiler.options.resolve.extensions = ['.js', '.ts', '.json']
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    const rules = path.join(projectRoot, 'scripts', 'rules.json')
    compiler.modifiedFiles = new Set([rules])
    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)

    expect(handler).not.toHaveBeenCalled()
    expect(compilation.warnings.length).toBe(0)

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([rules])
    runCycle(compiler, compilation)

    expect(compilation.errors.length).toBe(0)
  })

  it('restarts for a .mjsx or .mtsx entry like its .jsx sibling', async () => {
    const handler = bindRestartHandler()
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    for (const name of ['a.jsx', 'b.mjsx', 'c.mtsx']) {
      const fresh = path.join(projectRoot, 'scripts', name)
      compiler.modifiedFiles = new Set([fresh])
      compiler.removedFiles = new Set()
      runCycle(compiler, compilation)
      await restartSettled()

      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({reason: 'scripts', pathAfter: fresh})
      )
    }

    expect(handler).toHaveBeenCalledTimes(3)
    expect(compilation.warnings.length).toBe(0)
  })

  it('asks the injected requester and stays quiet when a session takes the change', () => {
    const requests: unknown[] = []
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'pages'), {recursive: true})
    const withCompiler = {...compilation, compiler}
    new WarnUponFolderChanges({
      requestRestart: (target, request) => {
        requests.push({target, request})

        return true
      }
    }).apply(compiler as any)

    const page = path.join(projectRoot, 'pages', 'added.html')
    compiler.modifiedFiles = new Set([page])
    runCycle(compiler, withCompiler)
    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([page])
    runCycle(compiler, withCompiler)

    expect(requests).toEqual([
      {target: compiler, request: {reason: 'html', pathAfter: page}},
      {target: compiler, request: {reason: 'html', pathBefore: page}}
    ])

    expect(withCompiler.warnings).toEqual([])
    expect(withCompiler.errors).toEqual([])
  })

  it('falls back to the diagnostics when the injected requester has no session', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})
    new WarnUponFolderChanges({requestRestart: () => false}).apply(
      compiler as any
    )

    const script = path.join(projectRoot, 'scripts', 'late.ts')
    compiler.modifiedFiles = new Set([script])
    runCycle(compiler, compilation)

    expect(compilation.warnings).toHaveLength(1)
    expectRestartNotice(
      compilation.warnings[0],
      'Adding',
      'script files',
      'scripts',
      script
    )
  })

  it('finds a file the watcher never named by reading the folders again', () => {
    const requests: unknown[] = []
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    const page = path.join(projectRoot, 'pages', 'unnamed.html')
    const listings = [new Set<string>(), new Set([page])]
    const reads: unknown[] = []
    new WarnUponFolderChanges({
      readFolderFiles: (roots) => {
        reads.push(roots)

        return listings.shift() || new Set()
      },
      requestRestart: (_target, request) => {
        requests.push(request)

        return true
      }
    }).apply(compiler as any)

    runCycle(compiler, compilation)
    runCycle(compiler, compilation)

    expect(reads).toEqual([
      {
        pages: path.join(projectRoot, 'pages'),
        scripts: path.join(projectRoot, 'scripts')
      },
      {
        pages: path.join(projectRoot, 'pages'),
        scripts: path.join(projectRoot, 'scripts')
      }
    ])

    expect(requests).toEqual([{reason: 'html', pathAfter: page}])
  })
})

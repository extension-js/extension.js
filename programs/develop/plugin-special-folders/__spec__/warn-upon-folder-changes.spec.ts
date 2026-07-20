import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../messages'
import {WarnUponFolderChanges} from '../warn-upon-folder-changes'

vi.mock('../messages', () => ({
  serverRestartRequiredFromSpecialFolderMessageOnly: vi.fn(
    (addingOrRemoving: string, folder: string, typeOfAsset: string) =>
      `[${addingOrRemoving}] ${folder} ${typeOfAsset}`
  ),
  specialFolderChangeDetected: vi.fn(
    (_change: string, _folder: string, _filePath: string) => ''
  )
}))

const createFakeCompiler = () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extensionjs-special-folders-')
  )
  const watchRunCallbacks: Array<() => void> = []
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
  }
) => {
  ;(compiler.hooks.watchRun as any).__invokeAll()
  ;(compiler.hooks.thisCompilation as any).__invokeAll(compilation)
}

let compilation: {
  warnings: any[]
  errors: any[]
  contextDependencies: Set<string>
}
const tempDirs = new Set<string>()

beforeEach(() => {
  compilation = {warnings: [], errors: [], contextDependencies: new Set()}
  vi.clearAllMocks()
})

afterEach(() => {
  for (const dir of tempDirs) {
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

    compiler.modifiedFiles = new Set([
      path.join(projectRoot, 'pages', 'foo.html')
    ])
    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)
    expect(compilation.warnings.length).toBe(1)
    expect(
      (messages as any).serverRestartRequiredFromSpecialFolderMessageOnly
    ).toHaveBeenCalledWith('Adding', 'pages', 'HTML pages')

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([
      path.join(projectRoot, 'pages', 'foo.html')
    ])
    runCycle(compiler, compilation)
    expect(compilation.errors.length).toBe(1)
    expect(
      (messages as any).serverRestartRequiredFromSpecialFolderMessageOnly
    ).toHaveBeenCalledWith('Removing', 'pages', 'HTML pages')
  })

  it('warns on adding supported scripts and errors on removing; ignores unsupported extensions', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'scripts'), {recursive: true})
    new WarnUponFolderChanges().apply(compiler as any)

    compiler.modifiedFiles = new Set([
      path.join(projectRoot, 'scripts', 'content.ts'),
      path.join(projectRoot, 'scripts', 'note.md')
    ])
    compiler.removedFiles = new Set()
    runCycle(compiler, compilation)
    expect(compilation.warnings.length).toBe(1)
    expect(
      (messages as any).serverRestartRequiredFromSpecialFolderMessageOnly
    ).toHaveBeenCalledWith('Adding', 'scripts', 'script files')

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set([
      path.join(projectRoot, 'scripts', 'content.ts')
    ])
    runCycle(compiler, compilation)
    expect(compilation.errors.length).toBe(1)
    expect(
      (messages as any).serverRestartRequiredFromSpecialFolderMessageOnly
    ).toHaveBeenCalledWith('Removing', 'scripts', 'script files')
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
    expect(
      (messages as any).serverRestartRequiredFromSpecialFolderMessageOnly
    ).toHaveBeenCalledWith('Adding', 'scripts', 'script files')

    compilation.warnings.length = 0
    compiler.modifiedFiles = new Set([newFile])
    runCycle(compiler, compilation)
    expect(compilation.warnings.length).toBe(0)
  })

  it('falls back to the project root when special folders are missing', () => {
    const {compiler, projectRoot} = createFakeCompiler()
    tempDirs.add(projectRoot)

    new WarnUponFolderChanges().apply(compiler as any)
    runCycle(compiler, compilation)

    const deps = Array.from(compilation.contextDependencies).map((p) =>
      String(p).replace(/\\/g, '/')
    )
    expect(deps).toEqual([projectRoot.replace(/\\/g, '/')])
  })
})

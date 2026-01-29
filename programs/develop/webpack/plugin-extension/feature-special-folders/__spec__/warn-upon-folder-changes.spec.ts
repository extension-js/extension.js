import {describe, it, beforeEach, expect, vi} from 'vitest'
import * as path from 'path'
import {WarnUponFolderChanges} from '../warn-upon-folder-changes'
import * as messages from '../messages'

// Mock messages to avoid relying on terminal color formatting
vi.mock('../messages', () => ({
  serverRestartRequiredFromSpecialFolderMessageOnly: vi.fn(
    (addingOrRemoving: string, folder: string, typeOfAsset: string) =>
      `[${addingOrRemoving}] ${folder} ${typeOfAsset}`
  )
}))

const createFakeCompiler = () => {
  const projectRoot = path.join(path.parse(process.cwd()).root, 'project')
  const watchRunCallbacks: Array<() => void> = []
  const thisCompilationCallbacks: Array<(c: any) => void> = []
  const hooks: any = {
    watchRun: {
      tap: (_name: string, callback: () => void) => {
        watchRunCallbacks.push(callback)
      },
      __invokeAll: () => watchRunCallbacks.forEach((cb) => cb())
    },
    thisCompilation: {
      tap: (_name: string, callback: (c: any) => void) => {
        thisCompilationCallbacks.push(callback)
      },
      __invokeAll: (compilationInstance: any) =>
        thisCompilationCallbacks.forEach((cb) => cb(compilationInstance))
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

// Provide a shared compilation-like sink to capture warnings/errors
let compilation: {
  warnings: any[]
  errors: any[]
  contextDependencies: Set<string>
}

beforeEach(() => {
  compilation = {warnings: [], errors: [], contextDependencies: new Set()}
  vi.clearAllMocks()
})

describe('WarnUponFolderChanges', () => {
  it('warns on adding pages/*.html and errors on removing', () => {
    const {compiler, projectRoot} = createFakeCompiler()
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

  it('registers pages/ and scripts/ as context dependencies', () => {
    const {compiler, projectRoot} = createFakeCompiler()
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
})

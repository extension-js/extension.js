import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('case-sensitive-paths-webpack-plugin', () => ({
  default: class {
    apply() {}
  }
}))

vi.mock('../env', () => ({
  EnvPlugin: class {
    apply() {}
  }
}))

import {CompilationPlugin} from '..'
import {WatchProjectConfigPlugin} from '../watch-project-config'

type Compilation = {
  warnings: Array<Error & {name?: string}>
  fileDependencies: Set<string>
  missingDependencies: Set<string>
}

function createCompilation(): Compilation {
  return {
    warnings: [],
    fileDependencies: new Set<string>(),
    missingDependencies: new Set<string>()
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
      context: projectRoot
    },
    hooks: {
      watchRun: {tap: (_n: string, cb: () => void) => watchRun.push(cb)},
      thisCompilation: {
        tap: (_n: string, cb: (c: Compilation) => void) =>
          thisCompilation.push(cb)
      },
      done: noop,
      watchClose: noop,
      invalid: noop,
      failed: noop
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

function createProject(withConfig = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extensionjs-cfg-watch-'))
  tempDirs.add(dir)
  fs.mkdirSync(path.join(dir, 'src'), {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'src/manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'p', version: '1.0'})
  )

  if (withConfig) {
    fs.writeFileSync(
      path.join(dir, 'extension.config.js'),
      'export default {}\n'
    )
  }

  return dir
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, {recursive: true, force: true})
  }

  tempDirs.clear()
})

describe('WatchProjectConfigPlugin', () => {
  it('watches the config file so saving it is a change the session sees', () => {
    const projectRoot = createProject()
    const compiler = createFakeCompiler(projectRoot)
    new WatchProjectConfigPlugin(projectRoot).apply(compiler as never)

    const compilation = createCompilation()
    compiler.__cycle(compilation)

    expect([...compilation.fileDependencies]).toContain(
      path.join(projectRoot, 'extension.config.js')
    )

    // The first compile has nothing to report: the config is the one it read.
    expect(compilation.warnings).toEqual([])
  })

  it('watches the names that are absent so adding a config counts too', () => {
    const projectRoot = createProject(false)
    const compiler = createFakeCompiler(projectRoot)
    new WatchProjectConfigPlugin(projectRoot).apply(compiler as never)

    const compilation = createCompilation()
    compiler.__cycle(compilation)

    expect([...compilation.missingDependencies]).toContain(
      path.join(projectRoot, 'extension.config.js')
    )
  })

  it('names the file and the restart when the config changes mid-session', () => {
    const projectRoot = createProject()
    const configPath = path.join(projectRoot, 'extension.config.js')
    const compiler = createFakeCompiler(projectRoot)
    new WatchProjectConfigPlugin(projectRoot).apply(compiler as never)

    compiler.__cycle(createCompilation())
    fs.writeFileSync(configPath, 'export default {define: {A: "1"}}\n')
    compiler.modifiedFiles = new Set([configPath])

    const compilation = createCompilation()
    compiler.__cycle(compilation)

    expect(compilation.warnings).toHaveLength(1)
    expect(compilation.warnings[0].name).toBe('ProjectConfigChange')
    expect(String(compilation.warnings[0].message)).toContain(
      'extension.config.js'
    )

    expect(String(compilation.warnings[0].message)).toMatch(/extension dev/)
  })

  it('reports one save once, not on every later compile', () => {
    const projectRoot = createProject()
    const configPath = path.join(projectRoot, 'extension.config.js')
    const compiler = createFakeCompiler(projectRoot)
    new WatchProjectConfigPlugin(projectRoot).apply(compiler as never)

    fs.writeFileSync(configPath, 'export default {define: {A: "1"}}\n')
    compiler.modifiedFiles = new Set([configPath])

    const first = createCompilation()
    compiler.__cycle(first)
    compiler.modifiedFiles = new Set([path.join(projectRoot, 'src/other.js')])

    const later = createCompilation()
    compiler.__cycle(later)

    expect(first.warnings).toHaveLength(1)
    expect(later.warnings).toEqual([])
  })

  it('stays quiet for a save that leaves the config as the session read it', () => {
    const projectRoot = createProject()
    const configPath = path.join(projectRoot, 'extension.config.js')
    const compiler = createFakeCompiler(projectRoot)
    new WatchProjectConfigPlugin(projectRoot).apply(compiler as never)

    fs.writeFileSync(configPath, 'export default {}\n')
    compiler.modifiedFiles = new Set([configPath])

    const compilation = createCompilation()
    compiler.__cycle(compilation)

    expect(compilation.warnings).toEqual([])
  })

  it('tells a compiler rebuilt by a restart that the config is still stale', () => {
    const projectRoot = createProject()
    const configPath = path.join(projectRoot, 'extension.config.js')
    new WatchProjectConfigPlugin(projectRoot).apply(
      createFakeCompiler(projectRoot) as never
    )

    fs.writeFileSync(configPath, 'export default {define: {A: "1"}}\n')

    const rebuilt = createFakeCompiler(projectRoot)
    new WatchProjectConfigPlugin(projectRoot).apply(rebuilt as never)

    const compilation = createCompilation()
    rebuilt.__cycle(compilation)

    expect(compilation.warnings.map((warning) => warning.name)).toEqual([
      'ProjectConfigChange'
    ])
  })
})

describe('the compilation plugin wiring', () => {
  it('watches the project config during a watch run', () => {
    const projectRoot = createProject()
    const compiler = createFakeCompiler(projectRoot)
    new CompilationPlugin({
      manifestPath: path.join(projectRoot, 'src/manifest.json'),
      browser: 'chrome',
      clean: false,
      command: 'dev'
    }).apply(compiler as never)

    fs.writeFileSync(
      path.join(projectRoot, 'extension.config.js'),
      'export default {define: {A: "1"}}\n'
    )

    compiler.modifiedFiles = new Set([
      path.join(projectRoot, 'extension.config.js')
    ])

    const compilation = createCompilation()
    compiler.__cycle(compilation)

    expect(compilation.warnings.map((warning) => warning.name)).toContain(
      'ProjectConfigChange'
    )
  })

  it('leaves a one-shot build alone', () => {
    const projectRoot = createProject()
    const compiler = createFakeCompiler(projectRoot, false)
    new CompilationPlugin({
      manifestPath: path.join(projectRoot, 'src/manifest.json'),
      browser: 'chrome',
      clean: false,
      command: 'build'
    }).apply(compiler as never)

    const compilation = createCompilation()
    compiler.__cycle(compilation)

    expect([...compilation.fileDependencies]).toEqual([])
  })
})

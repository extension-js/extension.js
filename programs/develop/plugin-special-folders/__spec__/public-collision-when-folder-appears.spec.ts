import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {SpecialFoldersPlugin} from '..'

// A public/ folder the session did not have at startup now feeds the copier,
// so the output collision it can cause has to reach the same named refusal a
// startup folder gets. The plugin decides what to tap while the folder is
// still absent, which is the pairing these cases pin.

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function createProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-late-public-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'p', version: '1.0'})
  )

  return root
}

function writeCollidingFile(root: string, emitted: string): void {
  const target = path.join(root, 'public', emitted)
  fs.mkdirSync(path.dirname(target), {recursive: true})
  fs.writeFileSync(target, '<html></html>')
}

// The raw bundler text, styled and indented the way the real one arrives.
// Built from a real ESC byte on purpose: the guard strips ANSI before matching,
// so a fixture with a literal "[1m" in it leaves the needle unmatchable.
const ESC = String.fromCharCode(27)

function conflict(emitted: string) {
  return {
    message:
      `  ${ESC}[1m  × ${ESC}[31mConflict${ESC}[39m: Multiple assets emit ` +
      `different content to the same filename ${emitted}.${ESC}[22m`
  } as unknown as Error
}

type Compilation = {
  errors: Error[]
  warnings: Error[]
  contextDependencies: Set<string>
  fileDependencies: Set<string>
  hooks: {
    processAssets: {
      tap: (options: unknown, fn: () => void) => void
      tapPromise: () => void
    }
  }
}

function createCompilation(errors: Error[]): Compilation {
  return {
    errors,
    warnings: [],
    contextDependencies: new Set<string>(),
    fileDependencies: new Set<string>(),
    hooks: {
      processAssets: {
        tap: (_options: unknown, fn: () => void) => fn(),
        tapPromise: () => {}
      }
    }
  }
}

function createFakeCompiler(projectRoot: string) {
  const thisCompilation: Array<(compilation: Compilation) => void> = []
  const noop = {tap: () => {}}

  return {
    options: {mode: 'development', watchOptions: {}, context: projectRoot},
    __internal__registerBuiltinPlugin: () => {},
    hooks: {
      thisCompilation: {
        tap: (_name: string, cb: (compilation: Compilation) => void) =>
          thisCompilation.push(cb)
      },
      watchRun: noop,
      watchClose: noop,
      done: noop
    },
    modifiedFiles: new Set<string>(),
    removedFiles: new Set<string>(),
    // The compile runs after apply, which is when a late folder exists.
    __compile(compilation: Compilation) {
      for (const cb of thisCompilation) cb(compilation)
    }
  }
}

function collisionErrorsFrom(compilation: Compilation): string[] {
  return compilation.errors
    .filter((error) => (error as Error & {name?: string}).name)
    .map((error) => String((error as Error & {name?: string}).name))
}

describe('an output collision from a public folder that appeared later', () => {
  it('names the file when the folder was absent at startup', () => {
    const root = createProject()
    const compiler = createFakeCompiler(root)
    new SpecialFoldersPlugin({
      manifestPath: path.join(root, 'manifest.json')
    }).apply(compiler as never)

    // Only now does the author create the folder and drop the file in.
    writeCollidingFile(root, 'options/index.html')

    const compilation = createCompilation([conflict('options/index.html')])
    compiler.__compile(compilation)

    expect(collisionErrorsFrom(compilation)).toContain('PublicOutputCollision')
    const explained = compilation.errors.find(
      (error) => (error as Error & {name?: string}).name
    ) as Error & {file?: string}
    expect(explained.file).toBe(path.join('public', 'options/index.html'))
    expect(String(explained.message)).toContain('Rename')
  })

  it('still names the file when the folder was there at startup', () => {
    const root = createProject()
    writeCollidingFile(root, 'options/index.html')
    const compiler = createFakeCompiler(root)
    new SpecialFoldersPlugin({
      manifestPath: path.join(root, 'manifest.json')
    }).apply(compiler as never)

    const compilation = createCompilation([conflict('options/index.html')])
    compiler.__compile(compilation)

    expect(collisionErrorsFrom(compilation)).toContain('PublicOutputCollision')
  })

  it('stays quiet while no folder has appeared', () => {
    const root = createProject()
    const compiler = createFakeCompiler(root)
    new SpecialFoldersPlugin({
      manifestPath: path.join(root, 'manifest.json')
    }).apply(compiler as never)

    const compilation = createCompilation([conflict('options/index.html')])
    compiler.__compile(compilation)

    expect(collisionErrorsFrom(compilation)).not.toContain(
      'PublicOutputCollision'
    )
  })

  // `public: false` reads no folder, yet the explainer still resolves a path
  // under one left on disk. Ungated it would answer a clash between two
  // generated entries by naming a file that is not in the build at all.
  it('blames no public file for a clash it is not part of', () => {
    const root = createProject()
    writeCollidingFile(root, 'options/index.html')
    const compiler = createFakeCompiler(root)
    new SpecialFoldersPlugin({
      manifestPath: path.join(root, 'manifest.json'),
      folders: {public: false}
    }).apply(compiler as never)

    const compilation = createCompilation([conflict('options/index.html')])
    compiler.__compile(compilation)

    expect(collisionErrorsFrom(compilation)).not.toContain(
      'PublicOutputCollision'
    )

    // Not just the name: nothing it emits may point at the untouched folder.
    for (const error of compilation.errors) {
      expect(String(error.message)).not.toContain(
        path.join('public', 'options')
      )
    }
  })
})

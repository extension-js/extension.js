import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {sources} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {PlaceRuntimeScriptSheets} from '../steps/place-runtime-script-sheets'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, {recursive: true, force: true})
  }
})

const SHEET = '.a1b2{color:red}'
const HOOK = '(()=>{window.ran = 1})();'
const NAMING =
  'chrome.scripting.insertCSS({target:t,files:["scripts/hook.css"]})'

// A watch session over a real output folder: each build runs the step on
// the assets given, writes what is left to disk, then reports it done.
function session(mode: 'development' | 'production' = 'development') {
  const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-kept-sheet-'))
  roots.push(outputPath)

  const passes: Array<() => void> = []
  const finished: Array<(stats: unknown) => void> = []
  let store = new Map<string, sources.RawSource>()

  const compilation = {
    errors: [] as unknown[],
    hooks: {
      processAssets: {
        tap: (_tapped: unknown, pass: () => void) => passes.push(pass)
      }
    },
    getAssets: () =>
      [...store.entries()].map(([name, source]) => ({name, source})),
    getAsset: (name: string) =>
      store.has(name) ? {name, source: store.get(name)} : undefined,
    updateAsset: (name: string, source: sources.RawSource) => {
      store.set(name, source)
    },
    deleteAsset: (name: string) => {
      store.delete(name)
    }
  }

  new PlaceRuntimeScriptSheets({
    browser: 'chrome',
    includeList: {'scripts/hook': '/project/scripts/hook.js'}
  }).apply({
    options: {context: '/project', mode, output: {path: outputPath}},
    hooks: {
      thisCompilation: {
        tap: (_name: string, tapped: (compilation: unknown) => void) =>
          tapped(compilation)
      },
      done: {
        tap: (_name: string, tapped: (stats: unknown) => void) =>
          finished.push(tapped)
      }
    }
  } as any)

  const at = (name: string) => path.join(outputPath, ...name.split('/'))

  return {
    doneTaps: () => finished.length,
    has: (name: string) => fs.existsSync(at(name)),
    read: (name: string) => fs.readFileSync(at(name), 'utf8'),
    write: (name: string, text: string) => {
      fs.mkdirSync(path.dirname(at(name)), {recursive: true})
      fs.writeFileSync(at(name), text)
    },
    build: (assets: Record<string, string>, errors: unknown[] = []) => {
      store = new Map(
        Object.entries(assets).map(([name, text]) => [
          name,
          new sources.RawSource(text)
        ])
      )

      compilation.errors = errors

      for (const pass of passes) pass()

      if (errors.length === 0) {
        for (const [name, source] of store) {
          fs.mkdirSync(path.dirname(at(name)), {recursive: true})
          fs.writeFileSync(at(name), source.source().toString())
        }
      }

      for (const tapped of finished) tapped({compilation})
    }
  }
}

const built = (background: string) => ({
  'background/service_worker.js': background,
  'scripts/hook.js': HOOK,
  'scripts/hook.css': SHEET,
  'scripts/hook.css.map': '{"version":3}'
})

describe('a scripts/ sheet a dev session kept on disk for a call that named it', () => {
  it('leaves the output once the call is gone and the script carries the sheet', () => {
    const dev = session()

    dev.build(built(NAMING))
    expect(dev.has('scripts/hook.css')).toBe(true)
    expect(dev.has('scripts/hook.css.map')).toBe(true)
    expect(dev.read('scripts/hook.js')).toBe(HOOK)

    dev.build(built('chrome.runtime.id'))
    expect(dev.has('scripts/hook.css')).toBe(false)
    expect(dev.has('scripts/hook.css.map')).toBe(false)
    expect(dev.read('scripts/hook.js')).toContain(SHEET)
    expect(dev.has('background/service_worker.js')).toBe(true)
  })

  it('comes back with the call, and stays while any script names it', () => {
    const dev = session()

    dev.build(built(NAMING))
    dev.build(built('chrome.runtime.id'))
    dev.build(built(NAMING))
    dev.build(built(NAMING))

    expect(dev.read('scripts/hook.css')).toBe(SHEET)
    expect(dev.has('scripts/hook.css.map')).toBe(true)
    expect(dev.read('scripts/hook.js')).toBe(HOOK)
  })

  it('stays through a compile that failed', () => {
    const dev = session()

    dev.build(built(NAMING))
    dev.build(built('chrome.runtime.id'), [new Error('broken')])

    expect(dev.read('scripts/hook.css')).toBe(SHEET)
  })

  it('takes no file that belongs to no scripts/ entry', () => {
    const dev = session()

    dev.write('scripts/other.css', SHEET)
    dev.write('scripts/hook.css.txt', SHEET)
    dev.build(built('chrome.runtime.id'))

    expect(dev.has('scripts/other.css')).toBe(true)
    expect(dev.has('scripts/hook.css.txt')).toBe(true)
  })

  it('removes nothing in a production build, which starts from an empty folder', () => {
    const production = session('production')

    production.write('scripts/hook.css', SHEET)
    production.build(built('chrome.runtime.id'))

    expect(production.doneTaps()).toBe(0)
    expect(production.read('scripts/hook.css')).toBe(SHEET)
  })
})

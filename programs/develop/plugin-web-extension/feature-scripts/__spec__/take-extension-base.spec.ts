import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {Compilation, sources} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {TAKE_BLOCK_OPEN} from '../../../lib/extension-base-from-stack'
import {getCanonicalContentScriptEntryName} from '../contracts'
import {TakeExtensionBase} from '../steps/take-extension-base'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-take-base-'))
  )
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'take-base',
      version: '1.0.0',
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content/isolated.js']},
        {matches: ['<all_urls>'], js: ['content/main.js'], world: 'MAIN'}
      ]
    })
  )

  return root
}

// The step against the assets given, run as many times as asked.
function emit(browser: string, assets: Record<string, string>, runs = 1) {
  const root = project()
  const store = new Map(
    Object.entries(assets).map(([name, text]) => [
      name,
      new sources.RawSource(text)
    ])
  )
  const stages: number[] = []
  const passes: Array<() => void> = []
  const compilation = {
    hooks: {
      processAssets: {
        tap: (options: {stage: number}, pass: () => void) => {
          stages.push(options.stage)
          passes.push(pass)
        }
      }
    },
    getAssets: () =>
      [...store.entries()].map(([name, source]) => ({name, source})),
    getAsset: (name: string) =>
      store.has(name) ? {name, source: store.get(name)} : undefined,
    updateAsset: (name: string, source: sources.RawSource) => {
      store.set(name, source)
    }
  }

  new TakeExtensionBase({
    manifestPath: path.join(root, 'manifest.json'),
    browser
  } as any).apply({
    options: {context: root},
    hooks: {
      thisCompilation: {
        tap: (_name: string, tapped: (compilation: unknown) => void) =>
          tapped(compilation)
      }
    }
  } as any)

  for (let run = 0; run < runs; run++) {
    for (const pass of passes) pass()
  }

  return {
    stages,
    text: (name: string) => store.get(name)?.source().toString()
  }
}

const ISOLATED = `${getCanonicalContentScriptEntryName(0)}.js`
const MAIN = `${getCanonicalContentScriptEntryName(1)}.js`
const MAIN_DEV = `${getCanonicalContentScriptEntryName(1)}.1a2b3c4d.js`
const BODY = '(()=>{window.ran = 1})();'

describe('the step that opens a Gecko MAIN world file on the read of the base', () => {
  it('closes the MAIN world entry in the block, as shipped and as a dev session names it', () => {
    const built = emit('firefox', {
      [ISOLATED]: BODY,
      [MAIN]: `${BODY}\n//# sourceMappingURL=main.js.map`,
      [MAIN_DEV]: BODY
    })

    expect(built.text(MAIN)).toBe(
      `${TAKE_BLOCK_OPEN}${BODY}\n}\n//# sourceMappingURL=main.js.map`
    )

    expect(built.text(MAIN_DEV)).toBe(`${TAKE_BLOCK_OPEN}${BODY}\n}`)
    expect(built.text(ISOLATED)).toBe(BODY)
  })

  it('runs behind the block that keeps a completion value, so the read stays first', () => {
    const built = emit('firefox', {[MAIN]: BODY})

    expect(built.stages).toEqual([
      Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE + 200
    ])
  })

  it('closes a file once, however many times the session emits it', () => {
    const built = emit('firefox', {[MAIN]: BODY}, 3)

    expect(built.text(MAIN)).toBe(`${TAKE_BLOCK_OPEN}${BODY}\n}`)
  })

  it('leaves a hot update, a chunk and a file no block can hold as built', () => {
    const update = MAIN.replace(/\.js$/, '.1a2b3c4d.hot-update.js')
    const chunk = MAIN.replace(/\.js$/, '.lazy.js')
    const module = 'import value from "./value.js"\nwindow.ran = value'
    const built = emit('firefox', {
      [update]: BODY,
      [chunk]: BODY,
      [MAIN]: module
    })

    expect(built.text(update)).toBe(BODY)
    expect(built.text(chunk)).toBe(BODY)
    expect(built.text(MAIN)).toBe(module)
  })

  it.each([
    'chrome',
    'edge',
    'chromium',
    'safari'
  ])('%s: leaves every file as built', (browser) => {
    const built = emit(browser, {[ISOLATED]: BODY, [MAIN]: BODY})

    expect(built.stages).toEqual([])
    expect(built.text(MAIN)).toBe(BODY)
    expect(built.text(ISOLATED)).toBe(BODY)
  })
})

import * as vm from 'node:vm'
import {Compilation, sources} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  KeepCompletionValue,
  keepCompletionValueOf
} from '../steps/keep-completion-value'

// The step against the assets given, with the files a trace compiled for
// executeScript named the way the trace names them.
function emit(assets: Record<string, string>, injected: string[] = []) {
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

  new KeepCompletionValue().apply({
    hooks: {
      thisCompilation: {
        tap: (_name: string, tapped: (compilation: unknown) => void) =>
          tapped(compilation)
      }
    }
  } as any)

  for (const name of injected) keepCompletionValueOf(compilation, name)
  for (const pass of passes) pass()
  for (const pass of passes) pass()

  return {
    stages,
    text: (name: string) => String(store.get(name)?.source().toString())
  }
}

const KEPT = '(()=>{__extjsCompletion(41+1)})();'
const CLOSED =
  /^\{let __extjsCompletionValue;[\s\S]*\(__extjsCompletionValue\)\}$/

describe('the step that closes an injected file on its value', () => {
  it('closes a scripts/ file that carries a value, once and after minification', () => {
    const built = emit({'scripts/hook.js': KEPT})

    expect(built.text('scripts/hook.js')).toMatch(CLOSED)
    expect(
      built.text('scripts/hook.js').split('let __extjsCompletionValue')
    ).toHaveLength(2)

    expect(vm.runInNewContext(built.text('scripts/hook.js'), {})).toBe(42)
    expect(built.stages).toEqual([
      Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE + 100
    ])
  })

  it('leaves a scripts/ file built as an ES module as it was built', () => {
    // A module has no value to end on, and no block can hold an export.
    const module =
      'const start=function(){__extjsCompletion(1)};start();export{start as default};'
    const imports = 'import value from "./value.js";__extjsCompletion(value);'
    const built = emit({
      'scripts/mounted.js': module,
      'scripts/imports.js': imports
    })

    expect(built.text('scripts/mounted.js')).toBe(module)
    expect(built.text('scripts/imports.js')).toBe(imports)
  })

  it('closes a file the trace compiled for executeScript outside scripts/', () => {
    const quiet =
      'function helper(){return 1}try{globalThis.helper=helper}catch(e){}'
    const built = emit(
      {
        'injected/typed.js': KEPT,
        'injected/quiet.js': quiet,
        'injected/strict.js': `"use strict";${KEPT}`
      },
      ['injected/typed.js', 'injected/quiet.js', 'injected/strict.js']
    )
    const page: Record<string, unknown> = {}
    page.globalThis = page

    expect(vm.runInNewContext(built.text('injected/typed.js'), {})).toBe(42)
    // The lines that share its names would otherwise be what it ends on.
    expect(vm.runInNewContext(built.text('injected/quiet.js'), page)).toBe(
      undefined
    )

    expect(typeof page.helper).toBe('function')
    expect(
      built.text('injected/strict.js').startsWith('"use strict";{let ')
    ).toBe(true)

    expect(vm.runInNewContext(built.text('injected/strict.js'), {})).toBe(42)
  })

  it('leaves every other file alone, whatever it carries', () => {
    const built = emit({
      'background/service_worker.js': KEPT,
      'content_scripts/content-0.js': KEPT,
      'injected/copied.js': KEPT,
      'scripts/hook.1a2b3c4d.hot-update.js': KEPT,
      'scripts/quiet.js': 'window.ran=1'
    })

    for (const name of [
      'background/service_worker.js',
      'content_scripts/content-0.js',
      'injected/copied.js',
      'scripts/hook.1a2b3c4d.hot-update.js'
    ]) {
      expect(built.text(name), name).toBe(KEPT)
    }

    expect(built.text('scripts/quiet.js')).toBe('window.ran=1')
  })
})

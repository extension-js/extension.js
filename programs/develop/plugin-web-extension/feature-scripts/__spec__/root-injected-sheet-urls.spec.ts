import {Compilation, sources} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {CHROMIUM_EXTENSION_ROOT} from '../scripts-lib/injected-sheet-urls'
import {RootInjectedSheetUrls} from '../steps/root-injected-sheet-urls'

// The step against the assets given, run as many times as asked.
function emit(
  assets: Record<string, string>,
  options: {browser?: string; runs?: number} = {}
) {
  const store = new Map(
    Object.entries(assets).map(([name, text]) => [
      name,
      new sources.RawSource(text)
    ])
  )
  const stages: number[] = []
  const passes: Array<() => void> = []
  const updated: string[] = []
  const compilation = {
    hooks: {
      processAssets: {
        tap: (tapped: {stage: number}, pass: () => void) => {
          stages.push(tapped.stage)
          passes.push(pass)
        }
      }
    },
    getAssets: () =>
      [...store.entries()].map(([name, source]) => ({name, source})),
    updateAsset: (name: string, source: sources.RawSource) => {
      updated.push(name)
      store.set(name, source)
    }
  }

  new RootInjectedSheetUrls({
    browser: (options.browser || 'chrome') as any,
    includeList: {'scripts/hook': '/project/scripts/hook.js'}
  }).apply({
    options: {context: '/project', mode: 'production'},
    hooks: {
      thisCompilation: {
        tap: (_name: string, tapped: (compilation: unknown) => void) =>
          tapped(compilation)
      }
    }
  } as any)

  for (let run = 0; run < (options.runs || 1); run++) {
    for (const pass of passes) pass()
  }

  return {
    stages,
    updated,
    text: (name: string) => store.get(name)?.source().toString()
  }
}

const ROOTED = '.a{background-image:url(/assets/pic.4003208d.svg)}'
const FIXED = `.a{background-image:url("${CHROMIUM_EXTENSION_ROOT}assets/pic.4003208d.svg")}`

describe('the step that names an injected sheet url() from the extension', () => {
  it('rewrites the sheet of a declared group and the one kept beside a scripts/ file', () => {
    const built = emit({
      'content_scripts/content-0.css': ROOTED,
      'content_scripts/content-0.js': '(()=>{})();',
      'scripts/hook.css': ROOTED
    })

    expect(built.text('content_scripts/content-0.css')).toBe(FIXED)
    expect(built.text('scripts/hook.css')).toBe(FIXED)
    expect(built.updated.sort()).toEqual([
      'content_scripts/content-0.css',
      'scripts/hook.css'
    ])
  })

  it('leaves a sheet a page links, which resolves against its own file', () => {
    const built = emit({
      'action/index.css': ROOTED,
      'scripts/other.css': ROOTED,
      'content_scripts/content-0.js': `var css = ${JSON.stringify(ROOTED)}`
    })

    expect(built.text('action/index.css')).toBe(ROOTED)
    expect(built.text('scripts/other.css')).toBe(ROOTED)
    expect(built.updated).toEqual([])
  })

  it('does not touch a sheet that has no url() at the output root', () => {
    const plain = '.a{color:#0101c8}'
    const built = emit({'content_scripts/content-0.css': plain})

    expect(built.text('content_scripts/content-0.css')).toBe(plain)
    expect(built.updated).toEqual([])
  })

  it.each(['chrome', 'edge', 'chromium-based'])('runs for %s', (browser) => {
    const built = emit({'content_scripts/content-0.css': ROOTED}, {browser})

    expect(built.text('content_scripts/content-0.css')).toBe(FIXED)
  })

  it.each([
    'firefox',
    'gecko-based',
    'safari'
  ])('taps nothing for %s, whose sheet keeps its bytes', (browser) => {
    const built = emit({'content_scripts/content-0.css': ROOTED}, {browser})

    expect(built.stages).toEqual([])
    expect(built.text('content_scripts/content-0.css')).toBe(ROOTED)
  })

  it('runs behind the steps that read a sheet for the files it names', () => {
    const built = emit({'content_scripts/content-0.css': ROOTED})

    expect(built.stages).toHaveLength(1)
    expect(built.stages[0]).toBeGreaterThan(
      Compilation.PROCESS_ASSETS_STAGE_REPORT
    )
  })

  it('writes the sheet once however many times it runs', () => {
    const built = emit({'content_scripts/content-0.css': ROOTED}, {runs: 3})

    expect(built.text('content_scripts/content-0.css')).toBe(FIXED)
    expect(built.updated).toEqual(['content_scripts/content-0.css'])
  })
})

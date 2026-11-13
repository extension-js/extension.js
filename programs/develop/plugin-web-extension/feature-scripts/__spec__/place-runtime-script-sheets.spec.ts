import {Compilation, sources} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {getContentScriptCssProbeMarker} from '../contracts'
import {
  SHEET_BLOCK_CLOSE,
  SHEET_BLOCK_OPEN
} from '../scripts-lib/runtime-script-sheet'
import {PlaceRuntimeScriptSheets} from '../steps/place-runtime-script-sheets'

// The step against the assets given, run as many times as asked.
function emit(
  assets: Record<string, string>,
  options: {
    browser?: string
    mode?: string
    includeList?: Record<string, string>
    runs?: number
    between?: (store: Map<string, sources.RawSource>) => void
  } = {}
) {
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
        tap: (tapped: {stage: number}, pass: () => void) => {
          stages.push(tapped.stage)
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
    },
    deleteAsset: (name: string) => {
      store.delete(name)
    }
  }

  new PlaceRuntimeScriptSheets({
    browser: (options.browser || 'chrome') as any,
    includeList: options.includeList || {
      'scripts/hook': '/project/scripts/hook.js',
      'scripts/plain': '/project/scripts/plain.js'
    }
  }).apply({
    options: {context: '/project', mode: options.mode || 'production'},
    hooks: {
      thisCompilation: {
        tap: (_name: string, tapped: (compilation: unknown) => void) =>
          tapped(compilation)
      }
    }
  } as any)

  for (let run = 0; run < (options.runs || 1); run++) {
    if (run > 0) options.between?.(store)

    for (const pass of passes) pass()
  }

  return {
    stages,
    names: () => [...store.keys()].sort(),
    text: (name: string) => store.get(name)?.source().toString()
  }
}

const BODY = '(()=>{window.ran = 1})();'
const SHEET = '.a1b2{color:red}'
const count = (text: string | undefined, part: string) =>
  String(text).split(part).length - 1

describe('the step that hands a scripts/ file the sheet of its CSS modules', () => {
  it('opens the script on its sheet and ships no separate file', () => {
    const built = emit({
      'scripts/hook.js': BODY,
      'scripts/hook.css': SHEET,
      'scripts/plain.js': BODY
    })
    const hook = String(built.text('scripts/hook.js'))

    expect(hook.startsWith(SHEET_BLOCK_OPEN)).toBe(true)
    expect(hook.endsWith(`${SHEET_BLOCK_CLOSE}${BODY}`)).toBe(true)
    expect(hook).toContain(JSON.stringify(SHEET))
    expect(built.text('scripts/plain.js')).toBe(BODY)
    expect(built.names()).toEqual(['scripts/hook.js', 'scripts/plain.js'])
  })

  it('reaches the file a dev session names with a hash, and drops the sheet map', () => {
    const built = emit(
      {
        'scripts/hook.1a2b3c4d.js': `${BODY}\n//# sourceMappingURL=hook.js.map`,
        'scripts/hook.css': `${SHEET}\n/*# sourceMappingURL=hook.css.map*/`,
        'scripts/hook.css.map': '{}'
      },
      {mode: 'development'}
    )
    const hook = String(built.text('scripts/hook.1a2b3c4d.js'))

    expect(hook.startsWith(SHEET_BLOCK_OPEN)).toBe(true)
    expect(hook).not.toContain('hook.css.map')
    expect(built.names()).toEqual(['scripts/hook.1a2b3c4d.js'])
  })

  it('leaves a declared content script and its sheet as built', () => {
    const built = emit({
      'content_scripts/content-0.js': BODY,
      'content_scripts/content-0.css': SHEET,
      'scripts/hook.js': BODY
    })

    expect(built.text('content_scripts/content-0.js')).toBe(BODY)
    expect(built.text('content_scripts/content-0.css')).toBe(SHEET)
    expect(built.text('scripts/hook.js')).toBe(BODY)
  })

  it('does nothing in a build with no scripts/ file', () => {
    const built = emit(
      {
        'content_scripts/content-0.js': BODY,
        'content_scripts/content-0.css': SHEET
      },
      {includeList: {'content_scripts/content-0': '/project/content.js'}}
    )

    expect(built.stages).toEqual([])
    expect(built.text('content_scripts/content-0.js')).toBe(BODY)
  })

  it.each([
    [
      'insertCSS',
      'chrome.scripting.insertCSS({target: {tabId: 1}, files: ["scripts/hook.css"]})'
    ],
    [
      'a registration css entry',
      'chrome.scripting.registerContentScripts([{id: "hook", js: ["/scripts/hook.js"], css: ["/scripts/hook.css"]}])'
    ]
  ])('keeps the file and places no second copy when the author applies it with %s', (_route, background) => {
    const built = emit({
      'background/service_worker.js': background,
      'scripts/hook.js': BODY,
      'scripts/hook.css': SHEET
    })

    expect(built.text('scripts/hook.css')).toBe(SHEET)
    expect(built.text('scripts/hook.js')).toBe(BODY)
  })

  it('keeps the file for a script that fetches its own sheet', () => {
    const body = `fetch(chrome.runtime.getURL("scripts/hook.css"));${BODY}`
    const built = emit({'scripts/hook.js': body, 'scripts/hook.css': SHEET})

    expect(built.text('scripts/hook.css')).toBe(SHEET)
    expect(built.text('scripts/hook.js')).toBe(body)
  })

  it('does not read the marker the build left in the bundle as the author naming the file', () => {
    const body = `var probe="${getContentScriptCssProbeMarker('scripts/hook')}";${BODY}`
    const built = emit({'scripts/hook.js': body, 'scripts/hook.css': SHEET})

    expect(built.names()).toEqual(['scripts/hook.js'])
    expect(
      String(built.text('scripts/hook.js')).startsWith(SHEET_BLOCK_OPEN)
    ).toBe(true)
  })

  it('takes the sheet back out of a file once a later build names it', () => {
    const built = emit(
      {'scripts/hook.js': BODY, 'scripts/hook.css': SHEET},
      {
        runs: 2,
        between: (store) => {
          store.set('scripts/hook.css', new sources.RawSource(SHEET))
          store.set(
            'background/service_worker.js',
            new sources.RawSource('insertCSS({files: ["scripts/hook.css"]})')
          )
        }
      }
    )

    expect(built.text('scripts/hook.js')).toBe(BODY)
    expect(built.text('scripts/hook.css')).toBe(SHEET)
  })

  it('reads the sheet after the minifier and ahead of every step that lists what the build emitted', () => {
    const built = emit({'scripts/hook.js': BODY, 'scripts/hook.css': SHEET})

    expect(built.stages).toEqual([
      Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE
    ])

    expect(built.stages[0]).toBeGreaterThan(
      Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE
    )

    expect(built.stages[0]).toBeLessThan(
      Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
    )
  })

  it('replaces the sheet a session already wrote into a file it emits again', () => {
    const built = emit(
      {'scripts/hook.js': BODY, 'scripts/hook.css': SHEET},
      {
        runs: 2,
        between: (store) =>
          store.set(
            'scripts/hook.css',
            new sources.RawSource('.a1b2{color:blue}')
          )
      }
    )
    const hook = built.text('scripts/hook.js')

    expect(count(hook, SHEET_BLOCK_OPEN)).toBe(1)
    expect(hook).toContain('.a1b2{color:blue}')
    expect(hook).not.toContain(SHEET)
    expect(count(hook, BODY)).toBe(1)
  })

  it('gecko: builds the sheet the way a MAIN world file reads the base it took', () => {
    const sheet = '.a1b2{background:url(/assets/pic.svg)}'
    const chrome = emit({'scripts/hook.js': BODY, 'scripts/hook.css': sheet})
    const firefox = emit(
      {'scripts/hook.js': BODY, 'scripts/hook.css': sheet},
      {browser: 'firefox'}
    )

    expect(chrome.text('scripts/hook.js')).not.toContain('__extjsTakenBase')
    expect(firefox.text('scripts/hook.js')).toContain('__extjsTakenBase')
    expect(firefox.text('scripts/hook.js')).not.toContain('.split(')
  })
})

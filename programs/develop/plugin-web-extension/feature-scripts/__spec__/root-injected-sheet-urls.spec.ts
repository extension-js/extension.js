import {Compilation, sources} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  CHROMIUM_EXTENSION_ROOT,
  GECKO_EXTENSION_ROOT,
  noteNamedInjectedSheet,
  notePublicInjectedSheet
} from '../scripts-lib/injected-sheet-urls'
import {RootInjectedSheetUrls} from '../steps/root-injected-sheet-urls'

// The step against the assets given, run as many times as asked.
function emit(
  assets: Record<string, string>,
  options: {
    browser?: string
    runs?: number
    named?: string[]
    inPublic?: string[]
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
  const updated: string[] = []
  const warnings: Array<Error & {file?: string}> = []
  const compilation = {
    warnings,
    getAsset: (name: string) =>
      store.has(name) ? {name, source: store.get(name)} : undefined,
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

  // The sheets an injection call names by file, as the trace reports them.
  for (const name of options.named || []) {
    noteNamedInjectedSheet(compilation, name)
  }

  for (const name of options.inPublic || []) {
    notePublicInjectedSheet(compilation, name)
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
    warnings,
    text: (name: string) => store.get(name)?.source().toString()
  }
}

const ROOTED = '.a{background-image:url(/assets/pic.4003208d.svg)}'
const NAMED = `.a{background:url(${CHROMIUM_EXTENSION_ROOT}img/a.png)}`
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
    'firefox-based',
    'zen'
  ])('names the target from the Firefox address for %s', (browser) => {
    const built = emit(
      {
        'content_scripts/content-0.css': ROOTED,
        'scripts/hook.css': ROOTED,
        'action/index.css': ROOTED
      },
      {browser}
    )
    const fixed = `.a{background-image:url("${GECKO_EXTENSION_ROOT}assets/pic.4003208d.svg")}`

    expect(built.text('content_scripts/content-0.css')).toBe(fixed)
    expect(built.text('scripts/hook.css')).toBe(fixed)
    expect(built.text('action/index.css')).toBe(ROOTED)
  })

  it('taps nothing for safari, whose sheet keeps its bytes', () => {
    const built = emit(
      {'content_scripts/content-0.css': ROOTED},
      {browser: 'safari'}
    )

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

  const WRITTEN =
    '@import "base.css";.a{src:url("../fonts/a.ttf");background:url(img/bg.png)}.b{background:url(/img/root.png)}'

  it('names every target of a sheet injected by file, from where it sits', () => {
    const built = emit(
      {
        'styles/inject.css': WRITTEN,
        'styles/base.css': '.base{background:url(img/base.png)}'
      },
      {named: ['styles/inject.css']}
    )

    // Chromium drops the @import, so the imported rules stand in its place.
    expect(built.text('styles/inject.css')).toBe(
      `.base{background:url("${CHROMIUM_EXTENSION_ROOT}styles/img/base.png")}.a{src:url("${CHROMIUM_EXTENSION_ROOT}fonts/a.ttf");background:url("${CHROMIUM_EXTENSION_ROOT}styles/img/bg.png")}.b{background:url("${CHROMIUM_EXTENSION_ROOT}img/root.png")}`
    )

    // The imported file itself keeps its bytes.
    expect(built.text('styles/base.css')).toBe(
      '.base{background:url(img/base.png)}'
    )

    expect(built.updated).toEqual(['styles/inject.css'])
    expect(built.warnings).toEqual([])
  })

  it('writes a sheet two injected sheets import into both, as first written', () => {
    const built = emit(
      {
        'styles/a.css': '@import "b.css";.a{color:red}',
        'styles/b.css': '@import "shared/c.css";.b{color:red}',
        'styles/shared/c.css': '.c{background:url(c.png)}'
      },
      {named: ['styles/a.css', 'styles/b.css']}
    )
    const shared = `.c{background:url("${CHROMIUM_EXTENSION_ROOT}styles/shared/c.png")}`

    expect(built.text('styles/a.css')).toBe(
      `${shared}.b{color:red}.a{color:red}`
    )

    expect(built.text('styles/b.css')).toBe(`${shared}.b{color:red}`)
  })

  it('says once, with file and line, which import it could not write in', () => {
    const built = emit(
      {
        'styles/inject.css':
          '@import "https://fonts.example/far.css";\n@import "gone.css";\n.a{color:red}'
      },
      {named: ['styles/inject.css']}
    )

    expect(built.updated).toEqual([])
    expect(built.warnings.map((warning) => warning.name)).toEqual([
      'InjectedSheetImportKept',
      'InjectedSheetImportKept'
    ])

    expect(built.warnings[0].file).toBe('styles/inject.css')
    expect(built.warnings[0].message).toContain('styles/inject.css:1')
    expect(built.warnings[0].message).toContain('another origin')
    expect(built.warnings[1].message).toContain('styles/inject.css:2')
    expect(built.warnings[1].message).toContain("isn't in the output")
  })

  it('leaves a public/ sheet as written and names its first import', () => {
    const sheet = '.a{color:red}'
    const imports = `/* kept */\n@import "base.css";\n@import "more.css";\n${sheet}`
    const built = emit(
      {'styles/inject.css': imports, 'styles/plain.css': sheet},
      {inPublic: ['styles/inject.css', 'styles/plain.css']}
    )

    expect(built.updated).toEqual([])
    expect(built.warnings).toHaveLength(1)
    expect(built.warnings[0].name).toBe('PublicInjectedSheetImportIgnored')
    expect(built.warnings[0].file).toBe('public/styles/inject.css')
    expect(built.warnings[0].message).toContain('public/styles/inject.css:2')
    expect(built.warnings[0].message).toContain("imports 'base.css'")
  })

  it('names the first target of a public/ sheet Chrome reads against the page', () => {
    const sheet =
      '.a{background:url(https://example.com/a.png)}\n.b{background:url(data:image/png;base64,AAAA)}\n.c{src:url("../fonts/c.woff2")}\n.d{background:url(img/d.png)}'
    const built = emit(
      {'styles/inject.css': sheet, 'styles/named.css': NAMED},
      {inPublic: ['styles/inject.css', 'styles/named.css']}
    )

    expect(built.updated).toEqual([])
    expect(built.text('styles/inject.css')).toBe(sheet)
    expect(built.warnings).toHaveLength(1)
    expect(built.warnings[0].name).toBe('PublicInjectedSheetPageRelativeTarget')
    expect(built.warnings[0].file).toBe('public/styles/inject.css')
    expect(built.warnings[0].message).toContain('public/styles/inject.css:3')
    expect(built.warnings[0].message).toContain('url(../fonts/c.woff2)')
    expect(built.warnings[0].message).toContain(
      `url("${CHROMIUM_EXTENSION_ROOT}fonts/c.woff2")`
    )

    expect(built.warnings[0].message).toContain('web_accessible_resources')
  })

  it('says nothing of a public/ sheet on firefox, which loads the import', () => {
    const built = emit(
      {'styles/inject.css': '@import "base.css";.a{background:url(a.png)}'},
      {inPublic: ['styles/inject.css'], browser: 'firefox'}
    )

    expect(built.warnings).toEqual([])
  })

  it('leaves that sheet as written on firefox, which reads from the file', () => {
    const built = emit(
      {'styles/inject.css': WRITTEN},
      {named: ['styles/inject.css'], browser: 'firefox'}
    )

    expect(built.text('styles/inject.css')).toBe(WRITTEN)
    expect(built.updated).toEqual([])
  })
})

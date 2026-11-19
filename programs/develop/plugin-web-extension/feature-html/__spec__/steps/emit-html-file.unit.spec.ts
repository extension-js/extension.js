import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  EmitHtmlFile,
  manifestFieldForHtmlFeature
} from '../../steps/emit-html-file'

const tmpRoots: string[] = []

afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, {recursive: true, force: true})
})

function makeTmp(name: string) {
  const created = fs.mkdtempSync(
    path.join(os.tmpdir(), `extjs-emit-html-${name}-`)
  )
  tmpRoots.push(created)

  return fs.realpathSync(created)
}

function makeCompilation() {
  const state: any = {warnings: []}
  const assets: Record<string, any> = {}
  const innerCompilation: any = {
    hooks: {processAssets: {tap: (_: any, cb: any) => cb()}},
    warnings: state.warnings,
    emitAsset: (name: string, src: any) => {
      assets[name] = src
    }
  }

  return {
    state,
    assets,
    options: {mode: 'production'},
    hooks: {
      thisCompilation: {tap: (_: any, fn: any) => fn(innerCompilation)}
    }
  } as any
}

describe('EmitHtmlFile', () => {
  it('emits html source for include entries with both absolute-root and relative paths', () => {
    const tmp = makeTmp('emit')
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{"name":"X"}', 'utf8')
    const page = path.join(tmp, 'index.html')
    fs.writeFileSync(page, '<html></html>', 'utf8')
    const c = makeCompilation()
    new EmitHtmlFile({
      manifestPath,
      includeList: {
        'feature/index': '/index.html',
        'feature/rel': 'index.html'
      }
    } as any).apply(c as any)

    const keys = Object.keys(c.assets)
    expect(keys.length).toBeGreaterThanOrEqual(1)
    expect(keys.some((k) => k.endsWith('.html'))).toBe(true)
  })

  it('warns for missing pages/* include entries', () => {
    const tmp = makeTmp('emit2')
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{"name":"X"}', 'utf8')
    const c = makeCompilation()
    new EmitHtmlFile({
      manifestPath,
      includeList: {'pages/missing': path.join(tmp, 'pages', 'missing.html')}
    } as any).apply(c as any)

    expect(c.state.warnings).toHaveLength(1)

    const [warning] = c.state.warnings as Array<{name: string; message: string}>

    // A page of the pages folder is in no manifest field, so the message
    // names the file and never sends the reader to manifest.json.
    expect(warning.name).toBe('ManifestPageMissing')
    expect(warning.message).toContain('pages/missing')
    expect(warning.message).toContain(
      `NOT FOUND ${path.join(tmp, 'pages', 'missing.html')}`
    )

    expect(warning.message).not.toContain('manifest.json')
    expect(warning.message).not.toContain('field')
  })

  it('warns, naming the file, about a missing page that only a script opens', () => {
    const tmp = makeTmp('emit3')
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      '{"name":"X","devtools_page":"devtools.html"}',
      'utf8'
    )

    const warnings: Array<{name: string; message: string; file?: string}> = []
    const compilation = {
      warnings,
      errors: [],
      hooks: {processAssets: {tap: (_: unknown, run: () => void) => run()}}
    }

    new EmitHtmlFile({
      manifestPath,
      includeList: {'panel/index': path.join(tmp, 'panel', 'index.html')}
    } as any).apply({
      options: {mode: 'development'},
      hooks: {
        thisCompilation: {
          tap: (_: string, fn: (c: unknown) => void) => fn(compilation)
        }
      }
    } as any)

    expect(warnings.map((warning) => warning.name)).toEqual([
      'ManifestPageMissing'
    ])

    expect(warnings[0].message).toContain('panel/index')
    expect(warnings[0].message).toContain(
      `NOT FOUND ${path.join(tmp, 'panel', 'index.html')}`
    )

    expect(warnings[0].message).not.toContain('panel.index')
    expect(warnings[0].message).not.toContain('manifest.json')
    expect(warnings[0].file).toBeUndefined()
    expect(compilation.errors).toEqual([])
  })

  it('taps the asset stage under its own name', () => {
    const names: string[] = []
    const compilation = {
      hooks: {
        processAssets: {
          tap: (options: {name: string}) => names.push(options.name)
        }
      }
    }

    new EmitHtmlFile({
      manifestPath: '/x/manifest.json',
      includeList: {}
    } as any).apply({
      hooks: {thisCompilation: {tap: (_: string, fn: any) => fn(compilation)}}
    } as any)

    expect(names).toEqual(['html:emit-html-file'])
  })
})

describe('manifestFieldForHtmlFeature', () => {
  it('labels the options slot from the keys the target browser reads', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-emit-label-'))
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        name: 'X',
        options_page: 'legacy.html',
        'firefox:options_ui': {page: 'modern.html'}
      })
    )

    // Chrome never reads the firefox: key, so its missing file is the legacy one.
    expect(
      manifestFieldForHtmlFeature('options/index', manifestPath, 'chrome')
    ).toBe('options_page')

    expect(
      manifestFieldForHtmlFeature('options/index', manifestPath, 'firefox')
    ).toBe('options_ui.page')

    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('labels a prefixed popup key only on the browser that reads it', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-emit-label-'))
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        name: 'X',
        'chromium:action': {default_popup: 'popup.html'},
        'firefox:browser_action': {default_popup: 'popup.html'}
      })
    )

    expect(
      manifestFieldForHtmlFeature('action/index', manifestPath, 'edge')
    ).toBe('action.default_popup')

    expect(
      manifestFieldForHtmlFeature('action/index', manifestPath, 'firefox')
    ).toBe('browser_action.default_popup')

    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('names a real manifest field, or none for a page only a script names', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-emit-label-'))
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        name: 'X',
        devtools_page: 'devtools.html',
        web_accessible_resources: [
          {resources: ['shared/frame.html'], matches: ['<all_urls>']}
        ],
        chrome_settings_overrides: {startup_pages: ['start/index.html']}
      })
    )

    // A devtools panel is named by panels.create in a script, not by a field.
    expect(
      manifestFieldForHtmlFeature('panel/index', manifestPath, 'chrome')
    ).toBeUndefined()

    expect(
      manifestFieldForHtmlFeature('shared/frame', manifestPath, 'chrome')
    ).toBe('web_accessible_resources')

    expect(
      manifestFieldForHtmlFeature(
        'chrome_settings_overrides/startup-0',
        manifestPath,
        'chrome'
      )
    ).toBe('chrome_settings_overrides.startup_pages')

    fs.rmSync(tmp, {recursive: true, force: true})
  })
})

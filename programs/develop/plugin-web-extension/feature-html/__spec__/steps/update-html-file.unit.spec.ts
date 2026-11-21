import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {PluginInterface} from '../../../../types'
import {
  asCompiler,
  type TapCallback
} from '../../../__spec__/helpers/rspack-fakes'
import {patchHtml} from '../../html-lib/patch-html'
import {UpdateHtmlFile} from '../../steps/update-html-file'
import {
  type BuildIssue,
  type FakeAsset,
  type FakeSource,
  readSource
} from '../helpers/html-fakes'
import {trackTempFolders} from '../../../../__spec__/helpers/temp-folders'

const tempFolder = trackTempFolders()

function makeTmp(name: string) {
  const created = tempFolder(`extjs-update-html-${name}-`)

  return fs.realpathSync(created)
}

vi.mock('../../html-lib/patch-html', async () => {
  return {
    patchHtml: vi.fn(() => '<html><body>UPDATED</body></html>')
  }
})

describe('UpdateHtmlFile', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('updates html asset using patchHtml', async () => {
    const tmp = makeTmp('update')
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}', 'utf8')
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(html, '<html></html>')
    // The asset already differs from the file on disk, as it does once the
    // env step has templated it. The step must patch the asset, not the file.
    const templated = '<html><head><title>envBar</title></head></html>'
    const assets: Record<string, FakeSource | FakeAsset> = {
      'feature/index.html': {source: () => templated}
    }
    // The compilation owns the assets, so the step can find and replace them.
    const innerCompilation = {
      hooks: {processAssets: {tap: (_: unknown, cb: TapCallback) => cb()}},
      assets,
      updateAsset: (name: string, src: unknown) => {
        assets[name] = {
          source: {source: () => readSource(src)}
        }
      },
      errors: [] as BuildIssue[]
    }
    const c = {
      options: {mode: 'production'},
      hooks: {
        thisCompilation: {
          tap: (_: unknown, fn: TapCallback) => fn(innerCompilation)
        }
      }
    }
    new UpdateHtmlFile({
      manifestPath,
      includeList: {'feature/index': html}
    }).apply(asCompiler(c))

    expect(assets['feature/index.html']).toBeTruthy()
    expect((assets['feature/index.html'] as FakeAsset).source.source()).toBe(
      '<html><body>UPDATED</body></html>'
    )

    const call = vi.mocked(patchHtml).mock.calls[0]
    expect(call[2]).toBe(html)
    expect(call[6]).toBe(templated)
  })

  it('passes the asset record content when the compilation exposes getAsset', async () => {
    const tmp = makeTmp('update-get-asset')
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}', 'utf8')
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(html, '<html></html>')
    const templated = Buffer.from('<html><body>from-asset</body></html>')
    const innerCompilation = {
      hooks: {processAssets: {tap: (_: unknown, cb: TapCallback) => cb()}},
      getAsset: (name: string) =>
        name === 'feature/index.html'
          ? {name, source: {source: () => templated}, info: {}}
          : undefined,
      updateAsset: vi.fn(),
      errors: [] as BuildIssue[]
    }
    const c = {
      options: {mode: 'production'},
      hooks: {
        thisCompilation: {
          tap: (_: unknown, fn: TapCallback) => fn(innerCompilation)
        }
      }
    }
    new UpdateHtmlFile({
      manifestPath,
      includeList: {'feature/index': html}
    }).apply(asCompiler(c))

    const call = vi.mocked(patchHtml).mock.calls.at(-1)
    expect(call?.[6]).toBe(templated.toString('utf8'))
    expect(innerCompilation.updateAsset).toHaveBeenCalledTimes(1)
  })

  it('asks patchHtml for the options dialog floor only on the Chromium options_ui page', () => {
    const tmp = makeTmp('update-options-floor')
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        options_ui: {page: 'options.html', open_in_tab: false},
        action: {default_popup: 'popup.html'}
      }),
      'utf8'
    )

    const options = path.join(tmp, 'options.html')
    const popup = path.join(tmp, 'popup.html')
    fs.writeFileSync(options, '<html></html>')
    fs.writeFileSync(popup, '<html></html>')

    let emitted: Record<string, string> = {}

    const run = (browser: PluginInterface['browser']) => {
      vi.mocked(patchHtml).mockClear()
      emitted = {}
      const assets: Record<string, FakeSource | FakeAsset> = {
        'options/index.html': {source: () => '<html></html>'},
        'action/index.html': {source: () => '<html></html>'}
      }
      const innerCompilation = {
        hooks: {processAssets: {tap: (_: unknown, cb: TapCallback) => cb()}},
        assets,
        updateAsset: vi.fn(),
        emitAsset: (name: string, source: {source: () => string}) => {
          emitted[name] = String(source.source())
        },
        errors: [] as BuildIssue[]
      }
      const c = {
        options: {mode: 'production'},
        hooks: {
          thisCompilation: {
            tap: (_: unknown, fn: TapCallback) => fn(innerCompilation)
          }
        }
      }
      new UpdateHtmlFile({
        manifestPath,
        browser,
        includeList: {'options/index': options, 'action/index': popup}
      }).apply(asCompiler(c))

      return Object.fromEntries(
        vi
          .mocked(patchHtml)
          .mock.calls.map((call) => [call[1], call[7]?.optionsDialogFloor])
      )
    }

    expect(run('chrome')).toEqual({
      'options/index': true,
      'action/index': false
    })

    // The page links the floor, so the stylesheet ships beside it.
    expect(emitted).toEqual({
      'options/dialog-floor.css': 'html{min-height:32px}'
    })

    expect(run('firefox')).toEqual({
      'options/index': false,
      'action/index': false
    })

    expect(emitted).toEqual({})
  })
})

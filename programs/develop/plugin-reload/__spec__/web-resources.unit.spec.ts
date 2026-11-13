import {describe, expect, it} from 'vitest'
import {
  type ReloadInstruction,
  readWebAccessibleResources,
  reloadForNewWebResources
} from '../index'

const compilation = (manifest: unknown) =>
  ({
    getAsset: (name: string) =>
      name === 'manifest.json' && manifest !== undefined
        ? {
            source: {
              source: () =>
                typeof manifest === 'string'
                  ? manifest
                  : JSON.stringify(manifest)
            }
          }
        : undefined
  }) as never

const PAGE: ReloadInstruction = {
  type: 'page',
  changedAssets: ['src/logo.png'],
  label: 'page (src/logo.png)'
}

const CONTENT: ReloadInstruction = {
  type: 'content-scripts',
  changedContentScriptEntries: ['content_scripts/content-0'],
  changedAssets: ['src/logo.png'],
  label: 'content_script (src/logo.png)'
}

describe('readWebAccessibleResources', () => {
  it('reads every resource of an MV3 manifest, across groups, once and sorted', () => {
    expect(
      readWebAccessibleResources(
        compilation({
          web_accessible_resources: [
            {resources: ['b.png', 'a.png'], matches: ['<all_urls>']},
            {resources: ['a.png', 'fonts/*'], matches: ['https://a.test/*']}
          ]
        })
      )
    ).toEqual(['a.png', 'b.png', 'fonts/*'])
  })

  it('reads the flat list of an MV2 manifest', () => {
    expect(
      readWebAccessibleResources(
        compilation({web_accessible_resources: ['b.png', 'a.png']})
      )
    ).toEqual(['a.png', 'b.png'])
  })

  it('answers an empty list for a manifest that is missing, unreadable or lists none', () => {
    expect(readWebAccessibleResources(compilation(undefined))).toEqual([])
    expect(readWebAccessibleResources(compilation('{not json'))).toEqual([])
    expect(readWebAccessibleResources(compilation({}))).toEqual([])
    expect(
      readWebAccessibleResources(
        compilation({web_accessible_resources: [{resources: 'a.png'}, 7, null]})
      )
    ).toEqual([])
  })
})

// The browser keeps the list of the manifest it loaded, so a page is refused
// a file listed only since then until the extension reloads.
describe('reloadForNewWebResources', () => {
  it('reloads the extension when the emitted manifest lists a resource the loaded one did not', () => {
    expect(
      reloadForNewWebResources(PAGE, ['logo.aaaa.png'], ['logo.bbbb.png'])
    ).toEqual({
      type: 'full',
      changedAssets: ['src/logo.png'],
      label: 'extension (src/logo.png)'
    })
  })

  it('keeps the label of a content script edit on the reload it becomes', () => {
    expect(
      reloadForNewWebResources(CONTENT, ['logo.aaaa.png'], ['logo.bbbb.png'])
    ).toMatchObject({type: 'full', label: 'content_script (src/logo.png)'})
  })

  it('leaves an edit alone when every listed resource was already loaded', () => {
    expect(
      reloadForNewWebResources(PAGE, ['a.png', 'b.png'], ['b.png', 'a.png'])
    ).toBe(PAGE)

    // A resource the manifest stopped listing still loads until a reload.
    expect(reloadForNewWebResources(PAGE, ['a.png', 'b.png'], ['a.png'])).toBe(
      PAGE
    )

    expect(reloadForNewWebResources(undefined, [], [])).toBeUndefined()
  })

  it('leaves a reload that already reads the manifest again as it is', () => {
    const full: ReloadInstruction = {type: 'full', label: 'extension (x)'}
    const worker: ReloadInstruction = {
      type: 'service-worker',
      label: 'service_worker (x)'
    }

    expect(reloadForNewWebResources(full, [], ['a.png'])).toBe(full)
    expect(reloadForNewWebResources(worker, [], ['a.png'])).toBe(worker)
  })

  it('names the manifest when no edit was classified', () => {
    expect(reloadForNewWebResources(undefined, [], ['a.png'])).toEqual({
      type: 'full',
      changedAssets: ['manifest.json'],
      label: 'extension (manifest.json)'
    })
  })
})

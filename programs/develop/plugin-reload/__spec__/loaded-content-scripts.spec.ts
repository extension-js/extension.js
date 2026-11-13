import {describe, expect, it} from 'vitest'
import {createLoadedContentScripts, type ReloadInstruction} from '../index'

const BUNDLE = 'content_scripts/content-0.aaaaaaaa.js'
const SHEET = 'content_scripts/content-0.css'

const EDIT: ReloadInstruction = {
  type: 'content-scripts',
  changedContentScriptEntries: ['content_scripts/content-0'],
  changedAssets: ['content/styles.css'],
  label: 'content_script (content/styles.css)'
}

// The compile of a build whose manifest declares the content script itself,
// as Firefox, MV2 and a build without a worker keep it in development.
function compile(color: string, js = BUNDLE) {
  const assets: Record<string, string> = {
    [SHEET]: `.probe { color: ${color}; }\n`,
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'x',
      version: '0',
      content_scripts: [{matches: ['<all_urls>'], js: [js], css: [SHEET]}]
    })
  }

  return {
    errors: [],
    options: {context: '/tmp/ext', output: {path: '/tmp/ext/dist/firefox'}},
    getAsset: (name: string) =>
      name in assets ? {source: {source: () => assets[name]}} : undefined
  } as never
}

// Without a launched browser the dev server stands in for the plugin that
// remembers what the browser read, so both paths answer an edit alike.
describe('createLoadedContentScripts', () => {
  it('names a rewritten sheet for a browser that swaps it in place, once', () => {
    const loaded = createLoadedContentScripts({refreshInPlace: true})
    loaded.noteLoaded(compile('red'))

    const first = loaded.resolve(compile('blue'), EDIT)
    expect(first).toMatchObject({type: 'content-scripts'})
    expect(first?.refreshedStylesheets?.map((sheet) => sheet.file)).toEqual([
      SHEET
    ])

    const unrelated = loaded.resolve(compile('blue'), {
      type: 'page',
      label: 'page (options/index.html)'
    })
    expect(unrelated).toEqual({
      type: 'page',
      label: 'page (options/index.html)'
    })
  })

  it('reloads the extension for the same edit on a browser that cannot swap it, then compares with what that reload read', () => {
    const loaded = createLoadedContentScripts({refreshInPlace: false})
    loaded.noteLoaded(compile('red'))

    expect(loaded.resolve(compile('blue'), EDIT)).toMatchObject({type: 'full'})
    expect(loaded.resolve(compile('blue'), EDIT)).toBe(EDIT)
  })

  it('reloads the extension when a compile renames the bundle the manifest names', () => {
    const loaded = createLoadedContentScripts({refreshInPlace: true})
    loaded.noteLoaded(compile('red'))

    const renamed = loaded.resolve(
      compile('red', 'content_scripts/content-0.bbbbbbbb.js'),
      EDIT
    )
    expect(renamed).toMatchObject({type: 'full'})
    expect(renamed?.refreshedStylesheets).toBeUndefined()
  })

  it('leaves an edit alone when nothing the manifest names changed', () => {
    const loaded = createLoadedContentScripts({refreshInPlace: true})
    loaded.noteLoaded(compile('red'))

    expect(loaded.resolve(compile('red'), EDIT)).toBe(EDIT)
    expect(loaded.resolve(compile('red'), undefined)).toBeUndefined()
  })
})

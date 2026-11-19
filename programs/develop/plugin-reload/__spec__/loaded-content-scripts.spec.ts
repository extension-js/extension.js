import {describe, expect, it} from 'vitest'
import {
  createLoadedContentScripts,
  type ReloadInstruction,
  readContentScriptDigests,
  readContentScriptFiles,
  reloadForRenamedContentScripts,
  reloadForRewrittenContentScripts
} from '../classify-reload'

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
function compile(color: string, js = BUNDLE, resources?: string[]) {
  const assets: Record<string, string> = {
    [SHEET]: `.probe { color: ${color}; }\n`,
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'x',
      version: '0',
      content_scripts: [{matches: ['<all_urls>'], js: [js], css: [SHEET]}],
      ...(resources
        ? {web_accessible_resources: [{resources, matches: ['<all_urls>']}]}
        : {})
    })
  }

  return {
    errors: [],
    options: {context: '/tmp/ext', output: {path: '/tmp/ext/dist/firefox'}},
    getAsset: (name: string) =>
      name in assets ? {source: {source: () => assets[name]}} : undefined
  } as never
}

// The launched-browser plugin and the dev server without a browser both keep
// what the browser read here, so both paths answer an edit alike.
describe('createLoadedContentScripts', () => {
  it('names a rewritten sheet for a browser that swaps it in place, once', () => {
    const loaded = createLoadedContentScripts({refreshInPlace: true})
    loaded.noteLoaded(compile('red'))

    const first = loaded.resolve(compile('blue'), EDIT)
    expect(first).toMatchObject({type: 'content-scripts'})
    expect(first?.refreshedStylesheets?.map((sheet) => sheet.file)).toEqual([
      SHEET
    ])

    loaded.settle(true)

    const unrelated = loaded.resolve(compile('blue'), {
      type: 'page',
      label: 'page (options/index.html)'
    })
    expect(unrelated).toEqual({
      type: 'page',
      label: 'page (options/index.html)'
    })
  })

  // Nobody received the swap, so the open tabs still hold the old bytes and
  // the next save has to name the sheet again, whatever that save touched.
  it('names the sheet again when the swap reached no producer, until one takes it', () => {
    const loaded = createLoadedContentScripts({refreshInPlace: true})
    const page: ReloadInstruction = {
      type: 'page',
      label: 'page (options/index.html)'
    }
    const named = (instruction: ReloadInstruction | undefined) =>
      instruction?.refreshedStylesheets?.map((sheet) => sheet.file)

    loaded.noteLoaded(compile('red'))

    expect(named(loaded.resolve(compile('blue'), EDIT))).toEqual([SHEET])
    loaded.settle(false)

    expect(named(loaded.resolve(compile('blue'), page))).toEqual([SHEET])

    expect(named(loaded.resolve(compile('blue'), page))).toEqual([SHEET])
    loaded.settle(true)

    expect(loaded.resolve(compile('blue'), page)).toBe(page)
  })

  it('reloads the extension when the manifest lists a web resource the browser never loaded, once', () => {
    const loaded = createLoadedContentScripts({refreshInPlace: true})
    loaded.noteLoaded(compile('red', BUNDLE, ['assets/logo.aaaaaaaa.png']))

    const renamed = loaded.resolve(
      compile('red', BUNDLE, ['assets/logo.bbbbbbbb.png']),
      EDIT
    )
    expect(renamed).toMatchObject({
      type: 'full',
      label: 'content_script (content/styles.css)'
    })

    expect(
      loaded.resolve(compile('red', BUNDLE, ['assets/logo.bbbbbbbb.png']), EDIT)
    ).toBe(EDIT)
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

  // Chromium's dev manifest names only the stubs and the worker registers
  // the real files, so a sheet no manifest names is never compared.
  it('leaves a stylesheet the manifest does not name to the worker that registers it', () => {
    const stub = (color: string) => {
      const assets: Record<string, string> = {
        [SHEET]: `.probe { color: ${color}; }\n`,
        'manifest.json': JSON.stringify({
          manifest_version: 3,
          content_scripts: [
            {matches: ['<all_urls>'], js: ['content_scripts/dev-stub-0.js']}
          ]
        })
      }

      return {
        getAsset: (name: string) =>
          name in assets ? {source: {source: () => assets[name]}} : undefined
      } as never
    }

    const loaded = createLoadedContentScripts({refreshInPlace: false})
    loaded.noteLoaded(stub('red'))

    expect(loaded.resolve(stub('blue'), EDIT)).toBe(EDIT)
  })

  // A worker reload makes the browser read the manifest again, as a reload
  // of the whole extension does.
  it('takes a worker reload as the browser reading the renamed bundle', () => {
    const loaded = createLoadedContentScripts({refreshInPlace: true})
    const worker: ReloadInstruction = {
      type: 'service-worker',
      label: 'service_worker (src/background.ts)'
    }
    const renamed = 'content_scripts/content-0.bbbbbbbb.js'

    loaded.noteLoaded(compile('red'))

    expect(loaded.resolve(compile('red', renamed), worker)).toBe(worker)
    expect(loaded.resolve(compile('red', renamed), EDIT)).toBe(EDIT)
  })

  it('leaves an edit alone when nothing the manifest names changed', () => {
    const loaded = createLoadedContentScripts({refreshInPlace: true})
    loaded.noteLoaded(compile('red'))

    expect(loaded.resolve(compile('red'), EDIT)).toBe(EDIT)
    expect(loaded.resolve(compile('red'), undefined)).toBeUndefined()
  })
})

describe('readContentScriptFiles', () => {
  const manifest = (text: string | undefined) =>
    ({
      getAsset: (name: string) =>
        name === 'manifest.json' && text !== undefined
          ? {source: {source: () => text}}
          : undefined
    }) as never

  it('reads the scripts and then the sheets of every group, in manifest order', () => {
    expect(
      readContentScriptFiles(
        manifest(
          JSON.stringify({
            content_scripts: [
              {js: ['a.js', 'b.js'], css: ['a.css']},
              {css: ['c.css']},
              {js: ['d.js', 7]}
            ]
          })
        )
      )
    ).toEqual(['a.js', 'b.js', 'a.css', 'c.css', 'd.js'])
  })

  it('answers an empty list for a manifest that is missing, unreadable or names none', () => {
    expect(readContentScriptFiles(manifest(undefined))).toEqual([])
    expect(readContentScriptFiles(manifest('{not json'))).toEqual([])
    expect(readContentScriptFiles(manifest('{"name": "x"}'))).toEqual([])
    expect(
      readContentScriptFiles(manifest('{"content_scripts": "all"}'))
    ).toEqual([])
  })
})

describe('reloadForRenamedContentScripts', () => {
  const OTHER = 'content_scripts/content-0.bbbbbbbb.js'

  it('reloads the extension under the label of the content edit that renamed the bundle', () => {
    expect(reloadForRenamedContentScripts(EDIT, [BUNDLE], [OTHER])).toEqual({
      ...EDIT,
      type: 'full'
    })
  })

  it('names the manifest when no source explains the new name', () => {
    expect(
      reloadForRenamedContentScripts(undefined, [BUNDLE], [OTHER])
    ).toEqual({
      type: 'full',
      changedAssets: ['manifest.json'],
      label: 'extension (manifest.json)'
    })
  })

  it('names the extension, not the page, when a page edit rode along', () => {
    const page: ReloadInstruction = {
      type: 'page',
      changedAssets: ['options/index.html'],
      label: 'page (options/index.html)'
    }

    expect(reloadForRenamedContentScripts(page, [BUNDLE], [OTHER])).toEqual({
      type: 'full',
      changedAssets: ['options/index.html'],
      label: 'extension (options/index.html)'
    })
  })

  it('takes an added or a removed file as a rename', () => {
    expect(
      reloadForRenamedContentScripts(EDIT, [BUNDLE], [BUNDLE, SHEET])
    ).toMatchObject({type: 'full'})

    expect(reloadForRenamedContentScripts(EDIT, [BUNDLE], [])).toMatchObject({
      type: 'full'
    })
  })

  it('leaves an edit alone when the names and their order are the ones loaded', () => {
    expect(
      reloadForRenamedContentScripts(EDIT, [BUNDLE, SHEET], [BUNDLE, SHEET])
    ).toBe(EDIT)

    expect(
      reloadForRenamedContentScripts(undefined, [BUNDLE], [BUNDLE])
    ).toBeUndefined()
  })

  it('leaves a reload that already reads the manifest again as it is', () => {
    const full: ReloadInstruction = {type: 'full', label: 'extension'}
    const worker: ReloadInstruction = {
      type: 'service-worker',
      label: 'service_worker (src/background.ts)'
    }

    expect(reloadForRenamedContentScripts(full, [BUNDLE], [OTHER])).toBe(full)
    expect(reloadForRenamedContentScripts(worker, [BUNDLE], [OTHER])).toBe(
      worker
    )
  })
})

describe('readContentScriptDigests', () => {
  const compilation = (assets: Record<string, string>) =>
    ({
      getAsset: (name: string) =>
        name in assets ? {source: {source: () => assets[name]}} : undefined
    }) as never

  // A bundle carries the compile hash in its runtime, so its bytes change on
  // every compile under one name and say nothing about the edit.
  it('digests the stylesheets and skips the bundles', () => {
    const digests = readContentScriptDigests(
      compilation({[BUNDLE]: 'console.log(1)', [SHEET]: '.a{}'}),
      [BUNDLE, SHEET, 'content_scripts/missing.css']
    )

    expect(Object.keys(digests)).toEqual([SHEET])
  })

  it('answers differently once the bytes change', () => {
    const before = readContentScriptDigests(compilation({[SHEET]: '.a{}'}), [
      SHEET
    ])
    const after = readContentScriptDigests(compilation({[SHEET]: '.b{}'}), [
      SHEET
    ])

    expect(after[SHEET]).not.toBe(before[SHEET])
  })
})

describe('reloadForRewrittenContentScripts', () => {
  const content: ReloadInstruction = {
    type: 'content-scripts',
    changedContentScriptEntries: ['content_scripts/content-0'],
    changedAssets: ['src/widget.module.css'],
    label: 'content_script (src/widget.module.css)'
  }

  it('leaves a static entry to the worker, which reloads the extension and its tabs', () => {
    const instruction = {
      ...content,
      staticContentScriptEntries: ['content_scripts/content-0']
    }

    expect(
      reloadForRewrittenContentScripts(
        instruction,
        {[SHEET]: 'a'},
        {[SHEET]: 'b'}
      )
    ).toBe(instruction)
  })

  it('does not call a stylesheet the loaded manifest never named rewritten', () => {
    expect(reloadForRewrittenContentScripts(content, {}, {[SHEET]: 'b'})).toBe(
      content
    )
  })

  it('names the extension when no source explains the new bytes', () => {
    expect(
      reloadForRewrittenContentScripts(
        undefined,
        {[SHEET]: 'a'},
        {[SHEET]: 'b'}
      )
    ).toMatchObject({type: 'full', label: 'extension (manifest.json)'})
  })

  it('names the rewritten sheets instead of a reload for a browser that swaps them in place', () => {
    expect(
      reloadForRewrittenContentScripts(
        content,
        {[SHEET]: 'a', 'content_scripts/content-1.css': 'same'},
        {[SHEET]: 'b', 'content_scripts/content-1.css': 'same'},
        {refreshInPlace: true}
      )
    ).toEqual({...content, refreshedStylesheets: [{file: SHEET, digest: 'b'}]})
  })

  it('turns a page edit that rewrote a declared sheet into a swap, named by the sheet', () => {
    expect(
      reloadForRewrittenContentScripts(
        undefined,
        {[SHEET]: 'a'},
        {[SHEET]: 'b'},
        {refreshInPlace: true}
      )
    ).toEqual({
      type: 'content-scripts',
      changedAssets: [SHEET],
      refreshedStylesheets: [{file: SHEET, digest: 'b'}],
      label: `content_script (${SHEET})`
    })
  })

  it('keeps a reload that already restarts the extension or its worker, swap or not', () => {
    const full: ReloadInstruction = {type: 'full', label: 'extension'}

    expect(
      reloadForRewrittenContentScripts(
        full,
        {[SHEET]: 'a'},
        {[SHEET]: 'b'},
        {refreshInPlace: true}
      )
    ).toBe(full)
  })
})

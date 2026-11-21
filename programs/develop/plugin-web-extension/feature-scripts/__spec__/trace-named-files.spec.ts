import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  extractCssSubresourceLiterals,
  extractInjectedFileLiterals,
  extractOwnAddressLiterals,
  provenReferenceForms,
  TraceRuntimeLoadedFiles
} from '../steps/trace-runtime-loaded-files'
import {writeProjectFiles} from '../../../__spec__/helpers/extension-project'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, {recursive: true, force: true})
  }
})

function createTempProject(
  files: Record<string, string>,
  manifest: Record<string, unknown> = {}
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-named-'))
  tempDirs.push(dir)
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'fixture', ...manifest}),
    'utf8'
  )

  writeProjectFiles(dir, files)

  return dir
}

async function runTrace(
  projectDir: string,
  assets: Record<string, string>,
  entry: Record<string, unknown> = {},
  development?: {modules: string[]}
) {
  const emitted = new Map(
    Object.entries(assets).map(([name, src]) => [
      name,
      {name, source: {source: () => src}}
    ])
  )
  const compilation: any = {
    warnings: [],
    errors: [],
    fileDependencies: new Set<string>(),
    modules: (development?.modules ?? []).map((rel) => ({
      resource: path.join(projectDir, rel)
    })),
    getAsset: (name: string) => emitted.get(name),
    getAssets: () => Array.from(emitted.values()),
    emitAsset: (name: string, source: any) => {
      emitted.set(name, {name, source})
    },
    updateAsset: (name: string, source: any) => {
      emitted.set(name, {name, source})
    },
    createChildCompiler: () => {
      throw new Error('unexpected child compilation in a unit fixture')
    },
    hooks: {
      processAssets: {tapPromise: (_opts: any, fn: any) => fn()}
    }
  }
  const compiler: any = {
    options: {entry, mode: development ? 'development' : 'production'},
    hooks: {
      thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
    }
  }

  new TraceRuntimeLoadedFiles({
    manifestPath: path.join(projectDir, 'manifest.json')
  }).apply(compiler)

  await Promise.resolve()

  return {emitted, compilation}
}

const WORKER = 'background/service_worker.js'

describe('files a script names as a plain string', () => {
  it('ships a file the worker fetches through a variable', async () => {
    const dir = createTempProject({'config/sites.config': 'example.com'})
    // What the minifier leaves of a two-property table: the path stays in a
    // variable, so no fetch call holds it as a literal.
    const {emitted, compilation} = await runTrace(dir, {
      [WORKER]:
        '(()=>{let t="../config/sites.config";async function e(){let e=await fetch(t);console.log(await e.text())}chrome.runtime.onInstalled.addListener(e)})();'
    })

    expect(emitted.has('config/sites.config')).toBe(true)
    expect(compilation.warnings).toHaveLength(0)
  })

  it('ships every path of a table that also holds remote addresses', async () => {
    const dir = createTempProject({
      'config/dark-sites.config': 'a',
      'config/color-schemes.drconf': 'b',
      'icons/light_19.png': 'png'
    })
    const {emitted} = await runTrace(dir, {
      [WORKER]: [
        'const B="https://example.com/config";',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text
        'const URLS={a:{remote:`${B}/dark-sites.config`,local:"../config/dark-sites.config"},b:{remote:`${B}/color-schemes.drconf`,local:"../config/color-schemes.drconf"}};',
        'class I{static P={light:{19:"../icons/light_19.png"}};static set(){chrome.action.setIcon({path:I.P.light})}}',
        'const load=({url})=>fetch(url);load({url:URLS.a.local})'
      ].join('')
    })

    expect(emitted.has('config/dark-sites.config')).toBe(true)
    expect(emitted.has('config/color-schemes.drconf')).toBe(true)
    expect(emitted.has('icons/light_19.png')).toBe(true)
  })

  it('ships the file where a moved page asks for it', async () => {
    const dir = createTempProject({
      'ui/popup/index.html': '<script src="index.js"></script>',
      'ui/popup/index.js': '',
      'ui/assets/images/phone.svg': '<svg/>'
    })
    const {emitted} = await runTrace(
      dir,
      {
        'action/index.html':
          '<html><head><script src="/shared/commons.js" defer=""></script><script src="/action/index.js"></script></head></html>',
        'action/index.js': '',
        'shared/commons.js': 'img.src="../assets/images/phone.svg"'
      },
      {'action/index': {import: [path.join(dir, 'ui/popup/index.js')]}}
    )

    // The page now sits one folder deep, so the browser asks at the root.
    expect(emitted.has('assets/images/phone.svg')).toBe(true)
    expect(emitted.has('shared/assets/images/phone.svg')).toBe(false)
  })

  it('ships a root file a content script names, and only at the root', async () => {
    const dir = createTempProject({'data/words.json': '[]'})
    const {emitted} = await runTrace(dir, {
      'content_scripts/content-0.js':
        'const p="data/words.json";fetch(chrome.runtime.getURL(p))'
    })

    expect(emitted.has('data/words.json')).toBe(true)
    expect(emitted.has('content_scripts/data/words.json')).toBe(false)
  })

  it('leaves a module id of a development bundle alone', async () => {
    const dir = createTempProject({
      'images/logo.png': 'png',
      'images/read.png': 'png'
    })
    const {emitted} = await runTrace(
      dir,
      {
        [WORKER]:
          '__webpack_require__("./images/logo.png");const p="images/read.png";fetch(p)'
      },
      {},
      {modules: ['images/logo.png']}
    )

    expect(emitted.has('images/logo.png')).toBe(false)
    expect(emitted.has('images/read.png')).toBe(true)
  })

  it('leaves code, root names, public files and absent files alone', async () => {
    const dir = createTempProject({
      'lib/helper.js': 'self.helper = 1',
      'pages/about.html': '<p>about</p>',
      'package.json': '{}',
      'public/data/shared.json': '{}'
    })
    const {emitted, compilation} = await runTrace(dir, {
      [WORKER]:
        'const a=["lib/helper.js","pages/about.html","package.json","data/shared.json","data/gone.json"]'
    })

    expect([...emitted.keys()]).toEqual([WORKER])
    expect(compilation.warnings).toHaveLength(0)
  })
})

describe('scans of a script that holds a regular expression', () => {
  it('still reads an injection written after a pattern ending in two slashes', async () => {
    const dir = createTempProject({'inject/index.js': 'self.injected = 1'})
    const worker =
      'let c=/\\/\\*[\\s\\S]*?\\*\\//g;function r(e){return e.replace(c,"")}chrome.scripting.executeScript({target:{tabId:1},files:["/inject/index.js"]})'

    expect(extractInjectedFileLiterals(worker)).toEqual(['/inject/index.js'])

    const {emitted} = await runTrace(dir, {[WORKER]: worker})

    expect(emitted.has('inject/index.js')).toBe(true)
  })
})

describe('scripts registered by file', () => {
  it('reads the files a register call names', () => {
    expect(
      extractInjectedFileLiterals(
        'browser.contentScripts.register({matches:["<all_urls>"],js:[{file:"/inject/fallback.js"},{file:"/inject/index.js"}]})'
      )
    ).toEqual(['/inject/fallback.js', '/inject/index.js'])

    expect(
      extractInjectedFileLiterals(
        'chrome.userScripts.register([{id:"a",matches:["*://*/*"],js:[{file:"user/a.js"}]}])'
      )
    ).toEqual(['user/a.js'])
  })
})

describe('a stylesheet copied with its page', () => {
  it('reads url() and @import targets', () => {
    expect(
      extractCssSubresourceLiterals(
        [
          '@import "base.css";',
          '/* url(gone.png) */',
          '@font-face{src:url("../assets/fonts/a.ttf")}',
          ".a{background:url('img/a.png')}.b{background:url(img/b.svg#mark)}",
          '.c{background:url(data:image/png;base64,AAAA)}.d{fill:url(#grad)}',
          '.e{background:url("chrome-extension://__MSG_@@extension_id__/img/e.png")}',
          '.f{background:url(moz-extension://__MSG_@@extension_id__/img/f.png)}'
        ].join('\n')
      )
    ).toEqual([
      'base.css',
      '../assets/fonts/a.ttf',
      'img/a.png',
      'img/b.svg#mark',
      'data:image/png;base64,AAAA',
      '/img/e.png',
      '/img/f.png'
    ])
  })

  it('ships the fonts of a page opened by path', async () => {
    const dir = createTempProject({
      'ui/options/index.html':
        '<link rel="stylesheet" href="style.css"><script src="index.js"></script>',
      'ui/options/index.js': 'document.title = "options"',
      'ui/options/style.css':
        '@font-face{font-family:A;src:url("../assets/fonts/a.ttf")}',
      'ui/assets/fonts/a.ttf': 'font'
    })
    const {emitted} = await runTrace(dir, {
      [WORKER]: 'chrome.tabs.create({url:"/ui/options/index.html"})'
    })

    expect(emitted.has('ui/options/style.css')).toBe(true)
    expect(emitted.has('ui/assets/fonts/a.ttf')).toBe(true)
  })
})

describe('a stylesheet an injection call ships', () => {
  const SHEET_FILES = {
    'styles/inject.css':
      '@import "base.css";@font-face{font-family:A;src:url("../fonts/a.ttf")}body{background:url(img/bg.png)}',
    'styles/base.css': '.base{background:url("img/base.png")}',
    'styles/img/bg.png': 'png',
    'styles/img/base.png': 'png',
    'fonts/a.ttf': 'font'
  }

  it.each([
    [
      'scripting.insertCSS',
      'chrome.scripting.insertCSS({target:{tabId:1},files:["styles/inject.css"]})'
    ],
    ['tabs.insertCSS', 'browser.tabs.insertCSS(1,{file:"/styles/inject.css"})'],
    [
      'scripting.registerContentScripts',
      'chrome.scripting.registerContentScripts([{id:"a",matches:["<all_urls>"],css:["styles/inject.css"]}])'
    ]
  ])('ships what the sheet of %s loads, read from the sheet', async (_call, worker) => {
    const dir = createTempProject(SHEET_FILES)
    const {emitted, compilation} = await runTrace(dir, {[WORKER]: worker})

    expect([...emitted.keys()].sort()).toEqual([
      WORKER,
      'fonts/a.ttf',
      'styles/base.css',
      'styles/img/base.png',
      'styles/img/bg.png',
      'styles/inject.css'
    ])

    expect(compilation.warnings).toHaveLength(0)
  })

  it('ships a target spelled with the id the browser fills in', async () => {
    const dir = createTempProject({
      'styles/inject.css':
        '.a{background:url("chrome-extension://__MSG_@@extension_id__/images/a.png")}@font-face{font-family:B;src:url(moz-extension://__MSG_@@extension_id__/fonts/b.ttf)}',
      'images/a.png': 'png',
      'fonts/b.ttf': 'font'
    })
    const {emitted} = await runTrace(dir, {
      [WORKER]:
        'chrome.scripting.insertCSS({target:{tabId:1},files:["styles/inject.css"]})'
    })

    expect(emitted.has('images/a.png')).toBe(true)
    expect(emitted.has('fonts/b.ttf')).toBe(true)
  })

  it('ships them for a sheet a constant names', async () => {
    const dir = createTempProject(SHEET_FILES)
    const {emitted} = await runTrace(dir, {
      [WORKER]:
        'const SHEETS=["styles/inject.css"];chrome.scripting.insertCSS({target:{tabId:1},files:SHEETS})'
    })

    expect(emitted.has('styles/img/bg.png')).toBe(true)
    expect(emitted.has('fonts/a.ttf')).toBe(true)
  })

  it('stays quiet about a target that is remote, inline or absent', async () => {
    const dir = createTempProject({
      'styles/inject.css':
        '.a{background:url(https://example.com/a.png)}.b{background:url(data:image/png;base64,AAAA)}.c{background:url(img/gone.png)}'
    })
    const {emitted, compilation} = await runTrace(dir, {
      [WORKER]:
        'chrome.scripting.insertCSS({target:{tabId:1},files:["styles/inject.css"]})'
    })

    expect([...emitted.keys()].sort()).toEqual([WORKER, 'styles/inject.css'])
    expect(compilation.warnings).toHaveLength(0)
  })
})

describe('where a named file ships when the build moved its script', () => {
  const DATA = {'data/read.json': '{}', 'background.js': ''}
  // The worker the author wrote at the root, which the build moved.
  const movedWorker = (dir: string) => ({
    'background/service_worker': {import: [path.join(dir, 'background.js')]}
  })
  const shipped = (emitted: Map<string, unknown>) =>
    [...emitted.keys()].filter((name) => name.endsWith('read.json')).sort()

  it('reads the forms that prove an address', () => {
    expect(
      extractOwnAddressLiterals(
        'fetch("data/a.json");self.fetch("data/b.json");new URL("data/c.json",location);new URL("data/d.json",import.meta.url);client.fetch("data/e.json");fetch(path);new URL("data/f.json",base)'
      )
    ).toEqual(['data/a.json', 'data/b.json', 'data/c.json', 'data/d.json'])

    // A fetch the script declares itself proves nothing.
    expect(
      extractOwnAddressLiterals(
        'const fetch=(p)=>load(chrome.runtime.getURL(p));fetch("data/a.json")'
      )
    ).toEqual([])
  })

  it('names a form only when every mention agrees', () => {
    const source =
      'fetch("data/own.json");chrome.runtime.getURL("data/root.json");const T=["data/table.json","data/mixed.json"];fetch("data/mixed.json");fetch("data/both.json");chrome.runtime.getURL("data/both.json")'
    const forms = provenReferenceForms(source, [
      'data/own.json',
      'data/root.json',
      'data/table.json',
      'data/mixed.json',
      'data/mixed.json',
      'data/both.json',
      'data/both.json'
    ])

    expect([...forms]).toEqual([
      ['data/own.json', 'own'],
      ['data/root.json', 'root']
    ])
  })

  it('ships one copy beside the worker for a path handed straight to fetch', async () => {
    const dir = createTempProject(DATA)
    const {emitted} = await runTrace(
      dir,
      {[WORKER]: 'fetch("data/read.json").then((r)=>r.json())'},
      movedWorker(dir)
    )

    expect(shipped(emitted)).toEqual(['background/data/read.json'])
  })

  it('ships one copy at the root for a path handed straight to getURL', async () => {
    const dir = createTempProject(DATA)
    const {emitted} = await runTrace(
      dir,
      {[WORKER]: 'fetch(chrome.runtime.getURL("data/read.json"))'},
      movedWorker(dir)
    )

    expect(shipped(emitted)).toEqual(['data/read.json'])
  })

  it('ships one copy at the root for a path that starts at the root', async () => {
    const dir = createTempProject(DATA)
    const {emitted} = await runTrace(
      dir,
      {[WORKER]: 'const p="/data/read.json";load(p)'},
      movedWorker(dir)
    )

    expect(shipped(emitted)).toEqual(['data/read.json'])
  })

  it.each([
    ['held in a table', 'const T={a:"data/read.json",b:"x"};load(T.a)'],
    [
      'fetched and also held in a table',
      'fetch("data/read.json");const T={a:"data/read.json",b:"x"};load(T.a)'
    ],
    [
      'fetched and also handed to getURL',
      'fetch("data/read.json");chrome.runtime.getURL("data/read.json")'
    ],
    [
      'handed to a fetch the script declares',
      'function fetch(p){return load(chrome.runtime.getURL(p))}fetch("data/read.json")'
    ],
    ['handed to a method named fetch', 'client.fetch("data/read.json")']
  ])('keeps both copies for a path %s', async (_case, worker) => {
    const dir = createTempProject(DATA)
    const {emitted} = await runTrace(dir, {[WORKER]: worker}, movedWorker(dir))

    expect(shipped(emitted)).toEqual([
      'background/data/read.json',
      'data/read.json'
    ])
  })

  it('keeps both copies for a script no page names', async () => {
    const dir = createTempProject(DATA)
    const {emitted} = await runTrace(dir, {
      'chunks/lazy.js': 'fetch("data/read.json")'
    })

    expect(shipped(emitted)).toEqual([
      'chunks/data/read.json',
      'data/read.json'
    ])
  })

  it('reads background scripts from the root, where their page sits', async () => {
    const dir = createTempProject(DATA)

    for (const script of [
      'fetch("data/read.json")',
      'const T={a:"data/read.json",b:"x"};load(T.a)'
    ]) {
      const {emitted} = await runTrace(dir, {'background/scripts.js': script})

      expect(shipped(emitted)).toEqual(['data/read.json'])
    }
  })

  it('ships one copy beside a moved page, and both under a base element', async () => {
    const dir = createTempProject(DATA)
    const page = (head: string) => ({
      'action/index.html': `<html><head>${head}<script src="/action/index.js"></script></head></html>`,
      'action/index.js': 'fetch("data/read.json")'
    })

    expect(shipped((await runTrace(dir, page(''))).emitted)).toEqual([
      'action/data/read.json'
    ])

    expect(
      shipped((await runTrace(dir, page('<base href="/">'))).emitted)
    ).toEqual(['action/data/read.json', 'data/read.json'])
  })
})

describe('the license of a font the trace copies', () => {
  const FONTS = {
    'ui/fonts/a.woff2': 'font',
    'ui/fonts/LICENSE.txt': 'SIL Open Font License',
    'ui/fonts/OFL.txt': 'OFL',
    'ui/fonts/Notice': 'notice',
    'ui/fonts/copying.md': 'copying',
    'ui/fonts/licence-b.txt': 'licence',
    'ui/fonts/readme.md': 'not a license',
    'ui/fonts/LICENSES/nested.txt': 'a folder is not a file'
  }
  const licenses = (emitted: Map<string, unknown>) =>
    [...emitted.keys()]
      .filter((name) => !/\.(?:js|css|html|woff2|ttf)$/.test(name))
      .sort()

  it('ships every license-named file of the folder beside the font', async () => {
    const dir = createTempProject({
      ...FONTS,
      'styles/inject.css': '@font-face{src:url("../ui/fonts/a.woff2")}'
    })
    const {emitted} = await runTrace(dir, {
      [WORKER]:
        'chrome.scripting.insertCSS({target:{tabId:1},files:["styles/inject.css"]})'
    })

    expect(emitted.has('ui/fonts/a.woff2')).toBe(true)
    expect(licenses(emitted)).toEqual([
      'ui/fonts/LICENSE.txt',
      'ui/fonts/Notice',
      'ui/fonts/OFL.txt',
      'ui/fonts/copying.md',
      'ui/fonts/licence-b.txt'
    ])
  })

  it('ships it where the font ships, for a font read beside a moved worker', async () => {
    const dir = createTempProject({
      'background.js': '',
      'fonts/a.ttf': 'font',
      'fonts/LICENSE': 'license'
    })
    const {emitted} = await runTrace(
      dir,
      {[WORKER]: 'fetch("fonts/a.ttf")'},
      {
        'background/service_worker': {
          import: [path.join(dir, 'background.js')]
        }
      }
    )

    expect(emitted.has('background/fonts/a.ttf')).toBe(true)
    expect(licenses(emitted)).toEqual(['background/fonts/LICENSE'])
  })

  it('leaves a license alone when no font ships from its folder', async () => {
    const dir = createTempProject({
      ...FONTS,
      'ui/fonts/data.json': '{}',
      LICENSE: 'the project itself',
      'root.woff2': 'font'
    })
    const {emitted} = await runTrace(dir, {
      [WORKER]:
        'fetch(chrome.runtime.getURL("ui/fonts/data.json"));fetch(chrome.runtime.getURL("root.woff2"))'
    })

    // The notice beside a font at the root is the project's own.
    expect(emitted.has('root.woff2')).toBe(true)
    expect(licenses(emitted)).toEqual(['ui/fonts/data.json'])
  })
})

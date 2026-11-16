import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  extractCssSubresourceLiterals,
  extractInjectedFileLiterals,
  TraceRuntimeLoadedFiles
} from '../steps/trace-runtime-loaded-files'

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

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content, 'utf8')
  }

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
          '.c{background:url(data:image/png;base64,AAAA)}.d{fill:url(#grad)}'
        ].join('\n')
      )
    ).toEqual([
      'base.css',
      '../assets/fonts/a.ttf',
      'img/a.png',
      'img/b.svg#mark',
      'data:image/png;base64,AAAA'
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

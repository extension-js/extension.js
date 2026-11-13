import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  createLocalImportResolver,
  readScriptText
} from '../../shared/script-graph'
import {findRuntimeMainWorldEntries} from '../scripts-lib/runtime-main-world-scripts'
import {
  extractInjectedFileLiterals,
  extractMainWorldRegisteredFileLiterals,
  type ImportedModuleReader,
  planTracedFile,
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-trace-'))
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

function makeCompilation(
  assets: Record<string, string>,
  entry: Record<string, unknown> = {}
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
    getAsset: (name: string) => emitted.get(name),
    getAssets: () => Array.from(emitted.values()),
    emitAsset: (name: string, source: any) => {
      emitted.set(name, {name, source})
    },
    updateAsset: (name: string, source: any) => {
      emitted.set(name, {name, source})
    },
    // The fake never reaches the bundler: a plan that needs it fails loudly
    // here instead of silently passing.
    createChildCompiler: () => {
      throw new Error('unexpected child compilation in a unit fixture')
    },
    hooks: {
      processAssets: {tapPromise: (_opts: any, fn: any) => fn()}
    }
  }
  const compiler: any = {
    options: {entry},
    hooks: {
      thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
    }
  }

  return {compiler, compilation, emitted}
}

async function runTrace(
  projectDir: string,
  assets: Record<string, string>,
  browser?: string,
  entry?: Record<string, unknown>,
  sources: string[] = []
) {
  const made = makeCompilation(assets, entry)

  for (const source of sources) {
    made.compilation.fileDependencies.add(path.join(projectDir, source))
  }

  new TraceRuntimeLoadedFiles({
    manifestPath: path.join(projectDir, 'manifest.json'),
    browser: browser as any
  }).apply(made.compiler)

  // The fake tapPromise runs the handler right away, its promise settles the
  // first round, which is the only round a copy-only fixture has.
  await Promise.resolve()

  return made
}

describe('TraceRuntimeLoadedFiles manifest surfaces', () => {
  it('reads a popup declared under a browser prefix as a compiled surface', async () => {
    // The page pipeline relocates the popup, so a getURL to it must not copy
    // the raw source through. A raw manifest read misses the prefixed key.
    const files = {'popup.html': '<html></html>'}
    const manifest = {'firefox:action': {default_popup: 'popup.html'}}
    const assets = {
      'background/index.js': 'chrome.runtime.getURL("popup.html");'
    }

    const firefox = await runTrace(
      createTempProject(files, manifest),
      assets,
      'firefox'
    )
    expect(firefox.emitted.has('popup.html')).toBe(false)

    // On a chrome build the key resolves to nothing, so the file is a plain
    // getURL target and copies through.
    const chrome = await runTrace(
      createTempProject(files, manifest),
      assets,
      'chrome'
    )
    expect(chrome.emitted.has('popup.html')).toBe(true)
  })
})

describe('extractInjectedFileLiterals', () => {
  it('reads files arrays from chrome.scripting injection calls', () => {
    const literals = extractInjectedFileLiterals(
      'chrome.scripting.executeScript({target: {tabId}, files: ["scripts/a.js"]});' +
        'chrome.scripting.insertCSS({target: {tabId}, files: ["styles/a.css"]});' +
        'chrome.tabs.executeScript(tabId, {file: "legacy.js"});'
    )
    expect(literals).toEqual(['scripts/a.js', 'styles/a.css', 'legacy.js'])
  })

  // Regression: the retention corpus matched registerContentScripts by
  // substring, but the literal tracer never scanned it, so its files were
  // neither copied through nor checked.
  it('reads js and css arrays from registered content scripts', () => {
    const literals = extractInjectedFileLiterals(
      'chrome.scripting.registerContentScripts([{id: "one", matches: ["<all_urls>"], js: ["scripts/one.js", helper], css: ["styles/one.css"]}]);' +
        'chrome.scripting.updateContentScripts([{id:"one",js:["scripts/two.js"]}])'
    )
    expect(literals).toEqual([
      'scripts/one.js',
      'styles/one.css',
      'scripts/two.js'
    ])
  })

  it('ignores commented-out calls and computed arrays', () => {
    const literals = extractInjectedFileLiterals(
      '// chrome.scripting.registerContentScripts([{js: ["scripts/old.js"]}])\n' +
        'chrome.scripting.executeScript({target, files: list})'
    )
    expect(literals).toEqual([])
  })
})

describe('extractMainWorldRegisteredFileLiterals', () => {
  it('reads the js of a registration that names the MAIN world', () => {
    const literals = extractMainWorldRegisteredFileLiterals(
      'chrome.scripting.registerContentScripts([' +
        '{id: "a", js: ["scripts/hook.js"], world: "MAIN", matches: ["<all_urls>"]},' +
        '{id: "b", js: ["scripts/plain.js"], matches: ["<all_urls>"]}]);' +
        "browser.scripting.updateContentScripts([{id: 'a', js: ['scripts/next.js'], world: 'MAIN'}])"
    )
    expect(literals).toEqual(['scripts/hook.js', 'scripts/next.js'])
  })

  it('reads the files of an executeScript call that names the MAIN world', () => {
    const literals = extractMainWorldRegisteredFileLiterals(
      'chrome.scripting.executeScript({target: {tabId}, files: ["scripts/hook.js"], world: "MAIN"});' +
        "browser.scripting.executeScript({world: 'MAIN', files: ['scripts/a.js', 'scripts/b.js'], target: {tabId: id}})"
    )
    expect(literals).toEqual([
      'scripts/hook.js',
      'scripts/a.js',
      'scripts/b.js'
    ])
  })

  // An injection with no world runs isolated, and a world or a file list the
  // source computes cannot be read off the call.
  it('skips an executeScript call whose world or files are not MAIN literals', () => {
    const literals = extractMainWorldRegisteredFileLiterals(
      'chrome.scripting.executeScript({target: {tabId}, files: ["scripts/isolated.js"]});' +
        'chrome.scripting.executeScript({target: {tabId}, files: ["scripts/named.js"], world: "ISOLATED"});' +
        'chrome.scripting.executeScript({target: {tabId}, files: ["scripts/computed.js"], world: where});' +
        'chrome.scripting.executeScript({target: {tabId}, files: list, world: "MAIN"});' +
        'chrome.scripting.executeScript({target: {tabId}, func: run, world: "MAIN"});' +
        'chrome.tabs.executeScript(tabId, {file: "legacy.js"});' +
        '// chrome.scripting.executeScript({target, files: ["scripts/old.js"], world: "MAIN"})\n'
    )
    expect(literals).toEqual([])
  })
})

describe('TraceRuntimeLoadedFiles injected payloads', () => {
  it('warns once when an injection literal names the compiled source', async () => {
    const projectDir = createTempProject({
      'scripts/ss.ts': 'export {}\n'
    })
    const {compilation, emitted} = await runTrace(projectDir, {
      'background/service_worker.js':
        'chrome.scripting.executeScript({target: {tabId: 1}, files: ["scripts/ss.ts"]});',
      'action/index.js':
        'chrome.scripting.executeScript({target: {tabId: 1}, files: ["scripts/ss.ts"]});',
      'scripts/ss.js': 'console.log("compiled")'
    })

    expect(compilation.warnings).toHaveLength(1)
    const [warning] = compilation.warnings
    expect(warning.name).toBe('InjectedScriptCompiledSource')
    expect(warning.file).toBe('background/service_worker.js')
    expect(String(warning.message)).toContain(
      "injects 'scripts/ss.ts', but scripts/ss.ts is compiled to scripts/ss.js"
    )

    expect(String(warning.message)).toContain('Inject the emitted path')
    // The raw source must not ship next to its compiled output.
    expect(emitted.has('scripts/ss.ts')).toBe(false)
  })

  it('warns for a compiled source registered as a content script', async () => {
    const projectDir = createTempProject({
      'scripts/one.tsx': 'export {}\n'
    })
    const {compilation} = await runTrace(projectDir, {
      'background/service_worker.js':
        'chrome.scripting.registerContentScripts([{id: "one", matches: ["<all_urls>"], js: ["scripts/one.tsx"], css: ["styles/one.css"]}]);',
      'scripts/one.js': 'console.log("compiled")',
      'styles/one.css': 'body{}'
    })

    expect(compilation.warnings).toHaveLength(1)
    expect(String(compilation.warnings[0].message)).toContain(
      'scripts/one.tsx is compiled to scripts/one.js'
    )
  })

  it('stays silent when the literal names the emitted path', async () => {
    const projectDir = createTempProject({
      'scripts/ss.ts': 'export {}\n'
    })
    const {compilation} = await runTrace(projectDir, {
      'background/service_worker.js':
        'chrome.scripting.executeScript({target: {tabId: 1}, files: ["scripts/ss.js"]});',
      'scripts/ss.js': 'console.log("compiled")'
    })

    expect(compilation.warnings).toHaveLength(0)
  })

  it('still copies a classic .js payload verbatim', async () => {
    const projectDir = createTempProject({
      'inject/plain.js': 'function hello() { return 1 }\n'
    })
    const {compilation, emitted} = await runTrace(projectDir, {
      'background/service_worker.js':
        'chrome.scripting.executeScript({target: {tabId: 1}, files: ["inject/plain.js"]});'
    })

    expect(compilation.warnings).toHaveLength(0)
    expect(emitted.get('inject/plain.js')?.source.source().toString()).toBe(
      'function hello() { return 1 }\n'
    )
  })
})

describe('TraceRuntimeLoadedFiles getURL targets', () => {
  it('does not copy a getURL literal that spells a source the build already compiled', async () => {
    // scripts/helper.ts is a scripts/ entry emitted as scripts/helper.js. The
    // raw .ts used to ship beside it, hiding that the literal asks for a path
    // the browser refuses to run.
    const projectDir = createTempProject({
      'scripts/helper.ts': 'const label: string = "x"\nexport {}\n'
    })
    const {compilation, emitted} = await runTrace(projectDir, {
      'background/service_worker.js':
        'chrome.runtime.getURL("scripts/helper.ts"); chrome.runtime.getURL("scripts/helper.js");',
      'scripts/helper.js': 'console.log("compiled")'
    })

    expect(emitted.has('scripts/helper.ts')).toBe(false)
    expect(compilation.warnings).toHaveLength(1)
    expect(compilation.warnings[0].name).toBe('RuntimeGetURLCompiledSource')
    expect(String(compilation.warnings[0].message)).toContain(
      "loads 'scripts/helper.ts' via chrome.runtime.getURL(), but scripts/helper.ts is compiled to scripts/helper.js"
    )
  })
})

describe('TraceRuntimeLoadedFiles pages a WebKit build dropped', () => {
  const files = {
    'sidebar/index.html': '<!doctype html><p>panel</p>',
    'background.js': 'console.log(1)'
  }
  const manifest = {side_panel: {default_path: 'sidebar/index.html'}}
  const background =
    'chrome.windows.create({url: chrome.runtime.getURL("sidebar/index.html")})'

  it('warns on safari when a getURL literal opens the page a dropped side_panel named', async () => {
    const projectDir = createTempProject(files, manifest)
    const {compilation, emitted} = await runTrace(
      projectDir,
      {'background/service_worker.js': background},
      'safari'
    )

    expect(emitted.has('sidebar/index.html')).toBe(false)
    expect(compilation.warnings).toHaveLength(1)
    expect(compilation.warnings[0].name).toBe('WebkitDroppedPageOpened')
    expect(compilation.warnings[0].file).toBe('background/service_worker.js')

    const message = String(compilation.warnings[0].message)
    expect(message).toContain("opens 'sidebar/index.html'")
    expect(message).toContain('side_panel.default_path')
    expect(message).toContain('Safari has no side panel surface')
    expect(message).toContain('sidebar/index.html')
    expect(message).toContain('pages/')
  })

  it('stays silent on chrome, where the page ships under its key', async () => {
    const projectDir = createTempProject(files, manifest)
    const {compilation} = await runTrace(
      projectDir,
      {'background/service_worker.js': background},
      'chrome'
    )

    expect(compilation.warnings).toHaveLength(0)
  })

  it('stays silent on safari when the page is declared under a key Safari keeps', async () => {
    const projectDir = createTempProject(files, {
      action: {default_popup: 'sidebar/index.html'}
    })
    const {compilation} = await runTrace(
      projectDir,
      {'background/service_worker.js': background},
      'safari'
    )

    expect(compilation.warnings).toHaveLength(0)
  })
})

describe('planTracedFile', () => {
  const hasNone = () => false

  function plan(
    files: Record<string, string>,
    opts: {
      sourceRel: string
      distRel?: string
      loadsAs?: 'classic' | 'by-shape'
      hasAsset?: (name: string) => boolean
      publicFiles?: Record<string, string>
    }
  ) {
    const manifestDir = createTempProject({
      ...files,
      ...Object.fromEntries(
        Object.entries(opts.publicFiles || {}).map(([rel, content]) => [
          `public/${rel}`,
          content
        ])
      )
    })
    const result = planTracedFile({
      manifestDir,
      sourceRel: opts.sourceRel,
      distRel: opts.distRel || opts.sourceRel,
      loadsAs: opts.loadsAs || 'by-shape',
      hasAsset: opts.hasAsset || hasNone
    })

    return {manifestDir, result}
  }

  it('copies files the browser reads as data or runs as written', () => {
    const json = plan(
      {'data/config.json': '{}'},
      {sourceRel: 'data/config.json'}
    )
    expect(json.result).toMatchObject({
      kind: 'copy',
      emitPath: 'data/config.json'
    })

    const html = plan(
      {'ui/page.html': '<html></html>'},
      {sourceRel: 'ui/page.html'}
    )
    expect(html.result.kind).toBe('copy')

    // A classic .js keeps its side-by-side globals only when shipped verbatim.
    const classic = plan(
      {'lib/util.js': 'var UTIL = 1\nfunction util() {}\n'},
      {sourceRel: 'lib/util.js'}
    )
    expect(classic.result).toMatchObject({
      kind: 'copy',
      emitPath: 'lib/util.js'
    })
  })

  it('compiles an ES module .js, as a module when the runtime loads it by shape and as a classic script when injected', () => {
    const files = {'lib/mod.js': 'import x from "pkg"\nexport const y = x\n'}
    expect(plan(files, {sourceRel: 'lib/mod.js'}).result).toMatchObject({
      kind: 'compile',
      emitPath: 'lib/mod.js',
      format: 'module'
    })

    expect(
      plan(files, {sourceRel: 'lib/mod.js', loadsAs: 'classic'}).result
    ).toMatchObject({
      kind: 'compile',
      emitPath: 'lib/mod.js',
      format: 'classic'
    })
  })

  it('compiles a TypeScript literal to its .js spelling and reports the spelling', () => {
    const {manifestDir, result} = plan(
      {'lib/helper.ts': 'const a: number = 1\n'},
      {sourceRel: 'lib/helper.ts'}
    )
    expect(result).toEqual({
      kind: 'compile',
      sourcePath: path.join(manifestDir, 'lib/helper.ts'),
      emitPath: 'lib/helper.js',
      format: 'classic',
      spelledAs: 'lib/helper.ts'
    })
  })

  it('compiles a .mjs at its own spelling since the browser loads it', () => {
    expect(
      plan({'lib/m.mjs': 'export const a = 1\n'}, {sourceRel: 'lib/m.mjs'})
        .result
    ).toMatchObject({kind: 'compile', emitPath: 'lib/m.mjs', format: 'module'})
  })

  it('skips a source spelling whose compiled output another entry already emitted', () => {
    const {result} = plan(
      {'scripts/helper.ts': 'export {}\n'},
      {
        sourceRel: 'scripts/helper.ts',
        hasAsset: (name) => name === 'scripts/helper.js'
      }
    )
    expect(result).toEqual({
      kind: 'skip',
      reason: 'compiled-elsewhere',
      emitPath: 'scripts/helper.js',
      spelledAs: 'scripts/helper.ts'
    })
  })

  it('compiles the source sibling when a .js literal has no file of its own', () => {
    const {manifestDir, result} = plan(
      {'inject/classic.ts': 'function hi(n: string) {}\n'},
      {sourceRel: 'inject/classic.js', loadsAs: 'classic'}
    )
    expect(result).toEqual({
      kind: 'compile',
      sourcePath: path.join(manifestDir, 'inject/classic.ts'),
      emitPath: 'inject/classic.js',
      format: 'classic'
    })
  })

  it('reports a missing file, an emitted asset and a public/ file without touching disk', () => {
    expect(plan({}, {sourceRel: 'lib/nope.js'}).result).toEqual({
      kind: 'missing',
      emitPath: 'lib/nope.js'
    })

    expect(
      plan({'lib/a.ts': ''}, {sourceRel: 'lib/a.ts', hasAsset: () => true})
        .result
    ).toEqual({kind: 'skip', reason: 'emitted', emitPath: 'lib/a.ts'})

    expect(
      plan({}, {sourceRel: 'vendor/x.js', publicFiles: {'vendor/x.js': ''}})
        .result
    ).toEqual({kind: 'skip', reason: 'public', emitPath: 'vendor/x.js'})
  })

  it('never reaches outside the extension root', () => {
    expect(
      plan({}, {sourceRel: '../../etc/passwd', distRel: 'etc/passwd'}).result
    ).toEqual({kind: 'missing', emitPath: 'etc/passwd'})
  })
})

describe('TraceRuntimeLoadedFiles relocated pages', () => {
  it("points a moved page's relative tabs.create url at the emitted file", async () => {
    const projectDir = createTempProject(
      {
        'pages/settings/settings.html': '<html></html>',
        'pages/settings/settings.js': '',
        'pages/changelog.html': '<html><body>changes</body></html>'
      },
      {options_ui: {page: 'pages/settings/settings.html'}}
    )
    const {emitted} = await runTrace(
      projectDir,
      {
        'options/index.js': 'chrome.tabs.create({ url: "../changelog.html" });'
      },
      'chrome',
      {
        'options/index': {
          import: [path.join(projectDir, 'pages/settings/settings.js')]
        }
      }
    )

    expect(emitted.has('pages/changelog.html')).toBe(true)
    expect(String(emitted.get('options/index.js')?.source.source())).toContain(
      'url: "/pages/changelog.html"'
    )
  })

  it('leaves the url alone when the page did not move', async () => {
    const projectDir = createTempProject(
      {
        'options/index.html': '<html></html>',
        'options/index.js': '',
        'changelog.html': '<html></html>'
      },
      {options_ui: {page: 'options/index.html'}}
    )
    const {emitted} = await runTrace(
      projectDir,
      {'options/index.js': 'chrome.tabs.create({ url: "../changelog.html" });'},
      'chrome',
      {
        'options/index': {
          import: [path.join(projectDir, 'options/index.js')]
        }
      }
    )

    expect(String(emitted.get('options/index.js')?.source.source())).toContain(
      'url: "../changelog.html"'
    )
  })
})

describe('TraceRuntimeLoadedFiles importScripts choices', () => {
  const classic = (name: string) => `var ${name} = true\n`

  // importScripts resolves against the worker URL, background/service_worker.js.
  it('ships the literal branches of a conditional importScripts argument', async () => {
    const projectDir = createTempProject(
      {
        'background.js': '',
        'shared/x.js': classic('X_READY'),
        'shared/fallback.js': classic('FALLBACK_READY')
      },
      {background: {service_worker: 'background.js'}}
    )
    const {emitted} = await runTrace(projectDir, {
      'background/service_worker.js':
        'importScripts(base ? chrome.runtime.getURL(base + "/x.js") : "shared/x.js");\n' +
        'importScripts(useFallback ? "shared/fallback.js" : "shared/x.js");'
    })

    expect(emitted.has('background/shared/x.js')).toBe(true)
    expect(emitted.has('background/shared/fallback.js')).toBe(true)
  })

  it('ships the paths a worker lists and imports through a variable', async () => {
    const projectDir = createTempProject(
      {
        'background.js': '',
        'shared/y.js': classic('Y_READY'),
        'shared/z.js': classic('Z_READY')
      },
      {background: {service_worker: 'background.js'}}
    )
    const {emitted, compilation} = await runTrace(projectDir, {
      'background/service_worker.js':
        'for (const [name, path] of [["Y", "shared/y.js"], ["Z", "shared/z.js"], ["Gone", "shared/gone.js"]]) {\n' +
        '  importScripts(path)\n' +
        '}'
    })

    expect(emitted.has('background/shared/y.js')).toBe(true)
    expect(emitted.has('background/shared/z.js')).toBe(true)
    expect(emitted.has('background/shared/gone.js')).toBe(false)
    expect(compilation.warnings).toHaveLength(0)
  })

  // The dev worker carries the hot update loader, and a worker with an async
  // chunk carries the chunk loader. Neither imports a file the author wrote.
  it.each([
    [
      'dev hot update',
      '__webpack_require__.p + __webpack_require__.hu(chunkId)'
    ],
    ['minified chunk', 'r.p+r.u(e)']
  ])('copies no registered script beside the worker for the %s loader', async (_name, chunkUrl) => {
    const projectDir = createTempProject(
      {
        'background.js': '',
        'scripts/hook.js': classic('HOOK_READY')
      },
      {background: {service_worker: 'background.js'}}
    )
    const {emitted, compilation} = await runTrace(projectDir, {
      'scripts/hook.js': classic('HOOK_READY'),
      'background/service_worker.js':
        'chrome.scripting.registerContentScripts([{id: "hook", js: ["scripts/hook.js"], world: "MAIN", matches: ["<all_urls>"]}]);\n' +
        `importScripts(${chunkUrl});`
    })

    expect(emitted.has('background/scripts/hook.js')).toBe(false)
    expect(emitted.has('scripts/hook.js')).toBe(true)
    expect(compilation.warnings).toHaveLength(0)
  })

  it('ships a path held in a constant that importScripts reads', async () => {
    const projectDir = createTempProject(
      {
        'background.js': '',
        'shared/projection.js': classic('PROJECTION_READY')
      },
      {background: {service_worker: 'background.js'}}
    )
    const {emitted} = await runTrace(projectDir, {
      'background/service_worker.js':
        'const base = String(globalThis.BASE || "");\n' +
        'const projectionPath = base ? `${base}/src/shared/projection.js` : "shared/projection.js";\n' +
        'importScripts(base ? chrome.runtime.getURL(projectionPath) : projectionPath);'
    })

    expect(emitted.has('background/shared/projection.js')).toBe(true)
  })
})

const MAIN_GROUP = (file: string, id = 'hook') =>
  `{id: "${id}", js: ["${file}"], world: "MAIN", matches: ["<all_urls>"]}`

// Reads a constant the way each caller does. The plain reader hands back
// text and resolves from the entry, the full one also names the file.
function constantReaders(projectDir: string, entry: string) {
  const resolveImport = createLocalImportResolver(projectDir)
  const entryFile = path.join(projectDir, entry)

  const plain: ImportedModuleReader = (specifier) => {
    const resolved = resolveImport(entryFile, specifier)

    return (resolved && readScriptText(resolved)) ?? null
  }

  const full: ImportedModuleReader = (specifier, fromFile = entryFile) => {
    const resolved = resolveImport(fromFile, specifier)
    const source = resolved && readScriptText(resolved)

    return resolved && source != null ? {source, file: resolved} : null
  }

  return {plain, full}
}

// The MAIN world files the entry names, read through both kinds of reader
// and through the scan the build runs, which must all agree.
function mainWorldFilesOf(files: Record<string, string>, entry = 'bg.js') {
  const hooks = Object.fromEntries(
    Object.keys(files)
      .filter((name) => name.startsWith('scripts/'))
      .map((name) => [name.replace(/\.js$/, ''), name])
  )
  const projectDir = createTempProject(files)
  const source = fs.readFileSync(path.join(projectDir, entry), 'utf8')
  const {plain, full} = constantReaders(projectDir, entry)
  const viaPlain = extractMainWorldRegisteredFileLiterals(source, plain)
  const viaFull = extractMainWorldRegisteredFileLiterals(source, full)
  const viaBuild = findRuntimeMainWorldEntries({
    includeList: {
      'background/service_worker': path.join(projectDir, entry),
      ...Object.fromEntries(
        Object.entries(hooks).map(([name, file]) => [
          name,
          path.join(projectDir, file)
        ])
      )
    },
    manifestDir: projectDir,
    projectPath: projectDir
  }).map((found) => `${found.entryName}.js`)

  expect(viaFull).toEqual(viaPlain)
  expect([...viaBuild].sort()).toEqual([...new Set(viaPlain)].sort())

  return viaPlain
}

const HOOK_FILES = {
  'scripts/hook.js': 'window.__HOOK__ = 1\n',
  'scripts/other.js': 'window.__OTHER__ = 1\n'
}

describe('a registration named through a let or a name of two scopes', () => {
  const found = (background: string) =>
    mainWorldFilesOf({...HOOK_FILES, 'bg.js': background})

  it('reads a let that is assigned once', () => {
    expect(
      found(
        `let hooks = [${MAIN_GROUP('scripts/hook.js')}]\n` +
          'chrome.scripting.registerContentScripts(hooks)\n'
      )
    ).toEqual(['scripts/hook.js'])
  })

  it('reads a let from source text with CRLF line endings', () => {
    expect(
      found(
        `let hooks = [${MAIN_GROUP('scripts/hook.js')}]\r\n` +
          'chrome.scripting.registerContentScripts(hooks)\r\n'
      )
    ).toEqual(['scripts/hook.js'])
  })

  it('leaves a let that is assigned again alone', () => {
    for (const write of [
      'hooks = []',
      'hooks += 1',
      'hooks ||= []',
      'hooks++',
      '[hooks] = [[]]'
    ]) {
      expect(
        found(
          `let hooks = [${MAIN_GROUP('scripts/hook.js')}]\n` +
            `if (globalThis.reset) { ${write} }\n` +
            'chrome.scripting.registerContentScripts(hooks)\n'
        )
      ).toEqual([])
    }
  })

  it('reads the declaration of the scope the call sits in', () => {
    expect(
      found(
        `function a() {\n  const hooks = [${MAIN_GROUP('scripts/other.js')}]\n  return hooks\n}\n` +
          `function b() {\n  const hooks = [${MAIN_GROUP('scripts/hook.js')}]\n` +
          '  chrome.scripting.registerContentScripts(hooks)\n}\n'
      )
    ).toEqual(['scripts/hook.js'])
  })

  it('reads an outer declaration past an inner one of another function', () => {
    expect(
      found(
        `const hooks = [${MAIN_GROUP('scripts/hook.js')}]\n` +
          `function a() {\n  const hooks = [${MAIN_GROUP('scripts/other.js')}]\n  return hooks\n}\n` +
          'chrome.scripting.registerContentScripts(hooks)\n'
      )
    ).toEqual(['scripts/hook.js'])
  })

  it('leaves a name alone when a parameter or a second declaration hides it', () => {
    const outer =
      `let hooks = [${MAIN_GROUP('scripts/hook.js')}]\n` +
      `function a() {\n  let hooks = [${MAIN_GROUP('scripts/other.js')}]\n  return hooks\n}\n`

    for (const call of [
      'function b(hooks) {\n  chrome.scripting.registerContentScripts(hooks)\n}\n',
      'const b = (hooks) => chrome.scripting.registerContentScripts(hooks)\n',
      'const b = async hooks => chrome.scripting.registerContentScripts(hooks)\n',
      'function b({hooks}) {\n  chrome.scripting.registerContentScripts(hooks)\n}\n',
      'function b() {\n  const {hooks} = globalThis\n  chrome.scripting.registerContentScripts(hooks)\n}\n',
      'function b() {\n  var hooks\n  chrome.scripting.registerContentScripts(hooks)\n}\n',
      'try { run() } catch (hooks) {\n  chrome.scripting.registerContentScripts(hooks)\n}\n',
      'for (const hooks of lists) {\n  chrome.scripting.registerContentScripts(hooks)\n}\n'
    ]) {
      expect(found(outer + call)).toEqual([])
    }
  })

  it('never throws on text that is not balanced', () => {
    for (const broken of [
      'let hooks = [{js: ["scripts/hook.js"], world: "MAIN"\nchrome.scripting.registerContentScripts(hooks)\n',
      'let hooks = "unterminated\nchrome.scripting.registerContentScripts(hooks)\n',
      'let hooks = [\n}}}])\nchrome.scripting.registerContentScripts(hooks\n',
      'import {hooks from\nchrome.scripting.registerContentScripts(hooks)\n',
      'export * from\nexport {hooks as} from "./x.js"\nchrome.scripting.executeScript({files: [hooks, a.b], world: "MAIN"})\n'
    ]) {
      expect(() =>
        extractMainWorldRegisteredFileLiterals(broken, () => broken)
      ).not.toThrow()

      expect(() =>
        extractInjectedFileLiterals(broken, () => broken)
      ).not.toThrow()
    }
  })
})

describe('a registration named through a constant two imports away', () => {
  const CALL =
    'import {HOOKS} from "./lib/b.js"\nchrome.scripting.registerContentScripts(HOOKS)\n'

  it('follows a module that imports the constant and exports it again', () => {
    expect(
      mainWorldFilesOf({
        ...HOOK_FILES,
        'bg.js': CALL,
        'lib/b.js': 'import {HOOKS} from "./c.js"\nexport {HOOKS}\n',
        'lib/c.js': `export const HOOKS = [${MAIN_GROUP('scripts/hook.js')}]\n`
      })
    ).toEqual(['scripts/hook.js'])
  })

  it('follows a folder index and a specifier with no extension', () => {
    expect(
      mainWorldFilesOf({
        ...HOOK_FILES,
        'bg.js':
          'import {HOOKS} from "./lib"\nchrome.scripting.registerContentScripts(HOOKS)\n',
        'lib/index.ts': 'export {HOOKS} from "./more/c"\n',
        'lib/more/c.ts': `export const HOOKS = [${MAIN_GROUP('scripts/hook.js')}]\n`
      })
    ).toEqual(['scripts/hook.js'])
  })

  it('ends on an import cycle and past the hop limit', () => {
    expect(
      mainWorldFilesOf({
        ...HOOK_FILES,
        'bg.js': CALL,
        'lib/b.js': 'export {HOOKS} from "./c.js"\n',
        'lib/c.js': 'export {HOOKS} from "./b.js"\n'
      })
    ).toEqual([])

    const chain: Record<string, string> = {}

    for (let hop = 0; hop < 12; hop++) {
      chain[`lib/m${hop}.js`] = `export {HOOKS} from "./m${hop + 1}.js"\n`
    }

    expect(
      mainWorldFilesOf({
        ...HOOK_FILES,
        ...chain,
        'bg.js':
          'import {HOOKS} from "./lib/m0.js"\nchrome.scripting.registerContentScripts(HOOKS)\n',
        'lib/m12.js': `export const HOOKS = [${MAIN_GROUP('scripts/hook.js')}]\n`
      })
    ).toEqual([])
  })
})

describe('a registration named through other ways a module exports', () => {
  const CALL =
    'import {HOOKS} from "./hooks.js"\nchrome.scripting.registerContentScripts(HOOKS)\n'
  const found = (files: Record<string, string>, background = CALL) =>
    mainWorldFilesOf({...HOOK_FILES, 'bg.js': background, ...files})

  it('reads a constant listed in an export statement', () => {
    expect(
      found({
        'hooks.js': `const HOOKS = [${MAIN_GROUP('scripts/hook.js')}]\nexport {HOOKS}\n`
      })
    ).toEqual(['scripts/hook.js'])
  })

  it('reads a constant exported under another name', () => {
    expect(
      found({
        'hooks.js':
          `const inner = [${MAIN_GROUP('scripts/hook.js')}]\n` +
          `const HOOKS = [${MAIN_GROUP('scripts/other.js')}]\n` +
          'export {inner as HOOKS, HOOKS as unused}\n'
      })
    ).toEqual(['scripts/hook.js'])
  })

  it('reads a constant a module passes on from another', () => {
    expect(
      found({
        'hooks.js': 'export {inner as HOOKS} from "./more.js"\n',
        'more.js': `export const inner = [${MAIN_GROUP('scripts/hook.js')}]\n`
      })
    ).toEqual(['scripts/hook.js'])
  })

  it('reads a constant behind export star', () => {
    expect(
      found({
        'hooks.js': 'export * from "./empty.js"\nexport * from "./more.js"\n',
        'empty.js': 'export const unrelated = 1\n',
        'more.js': `export const HOOKS = [${MAIN_GROUP('scripts/hook.js')}]\n`
      })
    ).toEqual(['scripts/hook.js'])
  })

  it('reads a path through a namespace import', () => {
    expect(
      found(
        {
          'paths.js':
            'export const HOOK = "scripts/hook.js"\nexport const LIST = ["scripts/other.js"]\n'
        },
        'import * as paths from "./paths.js"\n' +
          'chrome.scripting.registerContentScripts([{id: "a", js: [paths.HOOK], world: "MAIN", matches: ["<all_urls>"]}])\n' +
          'chrome.scripting.executeScript({target: {tabId: 1}, files: paths.LIST, world: "MAIN"})\n'
      )
    ).toEqual(['scripts/hook.js', 'scripts/other.js'])
  })

  it('leaves a name two export stars both hold, a type export and a let written twice alone', () => {
    expect(
      found({
        'hooks.js': 'export * from "./one.js"\nexport * from "./two.js"\n',
        'one.js': `export const HOOKS = [${MAIN_GROUP('scripts/hook.js')}]\n`,
        'two.js': `export const HOOKS = [${MAIN_GROUP('scripts/other.js')}]\n`
      })
    ).toEqual([])

    expect(
      found({
        'hooks.ts': 'export type {HOOKS} from "./more.js"\n',
        'more.js': `export const HOOKS = [${MAIN_GROUP('scripts/hook.js')}]\n`
      })
    ).toEqual([])

    expect(
      found({
        'hooks.js':
          `let HOOKS = [${MAIN_GROUP('scripts/hook.js')}]\n` +
          'if (globalThis.none) HOOKS = []\nexport {HOOKS}\n'
      })
    ).toEqual([])
  })

  it('leaves a namespace the file also declares, and a member of no import, alone', () => {
    expect(
      found(
        {'paths.js': 'export const HOOK = "scripts/hook.js"\n'},
        'import * as paths from "./paths.js"\n' +
          'function start(paths) {\n' +
          '  chrome.scripting.executeScript({target: {tabId: 1}, files: [paths.HOOK, config.HOOK], world: "MAIN"})\n}\n' +
          'function other() {\n  const paths = {}\n  return paths\n}\n'
      )
    ).toEqual([])
  })
})

describe('an injection whose files are named by a constant', () => {
  it('reads a local constant in a files list', () => {
    expect(
      extractInjectedFileLiterals(
        'const HOOK = "inject/hook.js"\nconst SHEETS = ["inject/hook.css"]\n' +
          'chrome.scripting.executeScript({target: {tabId}, files: [HOOK, "inject/b.js", missing]})\n' +
          'chrome.scripting.insertCSS({target: {tabId}, files: SHEETS})\n' +
          'chrome.tabs.executeScript(tabId, {file: HOOK})\n'
      )
    ).toEqual([
      'inject/hook.js',
      'inject/b.js',
      'inject/hook.css',
      'inject/hook.js'
    ])
  })

  it('reads the minified shape of a constant', () => {
    expect(
      extractInjectedFileLiterals(
        '(()=>{"use strict";let e="scripts/hook.js",t="inject/extra.js";chrome.action.onClicked.addListener(c=>{chrome.scripting.executeScript({target:{tabId:c.id},files:[e],world:"MAIN"}),chrome.scripting.executeScript({target:{tabId:c.id},files:[t]}),console.log(e,t)})})();'
      )
    ).toEqual(['scripts/hook.js', 'inject/extra.js'])
  })

  it('reads an imported constant, a registration list and a namespace', () => {
    const projectDir = createTempProject({
      'bg.js':
        'import {HOOK, GROUPS} from "./lib/index.js"\nimport * as paths from "./lib/paths.js"\n' +
        'chrome.scripting.executeScript({target: {tabId: 1}, files: [HOOK]})\n' +
        'chrome.scripting.registerContentScripts(GROUPS)\n' +
        'chrome.scripting.insertCSS({target: {tabId: 1}, files: [paths.SHEET]})\n',
      'lib/index.js':
        'export * from "./paths.js"\n' +
        'export const GROUPS = [{id: "g", js: ["inject/group.js"], css: ["inject/group.css"], matches: ["<all_urls>"]}]\n',
      'lib/paths.js':
        'export const HOOK = "inject/hook.js"\nexport const SHEET = "inject/sheet.css"\n'
    })
    const source = fs.readFileSync(path.join(projectDir, 'bg.js'), 'utf8')
    const {plain, full} = constantReaders(projectDir, 'bg.js')
    const expected = [
      'inject/hook.js',
      'inject/sheet.css',
      'inject/group.js',
      'inject/group.css'
    ]

    expect(extractInjectedFileLiterals(source, plain)).toEqual(expected)
    expect(extractInjectedFileLiterals(source, full)).toEqual(expected)
    // With no reader the import is left alone, as before.
    expect(extractInjectedFileLiterals(source)).toEqual([])
  })

  it('ships a file a source names through an imported constant', async () => {
    const projectDir = createTempProject({
      'src/background.ts':
        'import {EXTRA} from "./paths"\n' +
        'chrome.scripting.executeScript({target: {tabId: 1}, files: [EXTRA]})\n',
      'src/paths.ts':
        'export const EXTRA: string = "inject/extra.js"\nexport const GONE = "inject/gone.js"\n',
      'src/unrelated.ts': 'import {GONE} from "./paths"\nconsole.log(GONE)\n',
      'inject/extra.js': 'var EXTRA_READY = true\n'
    })
    // The dev bundle keeps the import as a member of the module object.
    const assets = {
      'background/service_worker.js':
        'chrome.scripting.executeScript({target: {tabId: 1}, files: [_paths__WEBPACK_IMPORTED_MODULE_0__.EXTRA]});'
    }

    const before = await runTrace(projectDir, assets)
    expect(before.emitted.has('inject/extra.js')).toBe(false)

    const {emitted, compilation} = await runTrace(
      projectDir,
      assets,
      undefined,
      undefined,
      ['src/background.ts', 'src/paths.ts', 'src/unrelated.ts']
    )

    expect(emitted.get('inject/extra.js')?.source.source().toString()).toBe(
      'var EXTRA_READY = true\n'
    )

    expect(emitted.has('inject/gone.js')).toBe(false)
    expect(compilation.warnings).toHaveLength(0)
  })

  it('ships a file the minified bundle names through a constant', async () => {
    const projectDir = createTempProject({
      'inject/extra.js': 'var EXTRA_READY = true\n'
    })
    const {emitted, compilation} = await runTrace(projectDir, {
      'background/service_worker.js':
        '(()=>{"use strict";let e="inject/extra.js",t="inject/other.js";chrome.scripting.executeScript({target:{tabId:1},files:[e]}),console.log(e,t)})();'
    })

    expect(emitted.has('inject/extra.js')).toBe(true)
    expect(emitted.has('inject/other.js')).toBe(false)
    expect(compilation.warnings).toHaveLength(0)
  })
})

describe('TraceRuntimeLoadedFiles importScripts through a constant', () => {
  const classic = (name: string) => `var ${name} = true\n`
  const worker = (code: string) =>
    runTrace(
      createTempProject(
        {
          'background.js': '',
          'shared/wanted.js': classic('WANTED_READY'),
          'shared/also.js': classic('ALSO_READY'),
          'shared/unwanted.js': classic('UNWANTED_READY')
        },
        {background: {service_worker: 'background.js'}}
      ),
      {'background/service_worker.js': code}
    )

  it('ships the file the constant names and no other listed path', async () => {
    const {emitted, compilation} = await worker(
      'const WANTED = "shared/wanted.js"\nconst UNWANTED = "shared/unwanted.js"\n' +
        'importScripts(WANTED)\nconsole.log(UNWANTED)\n'
    )

    expect(emitted.has('background/shared/wanted.js')).toBe(true)
    expect(emitted.has('background/shared/unwanted.js')).toBe(false)
    expect(compilation.warnings).toHaveLength(0)
  })

  it('reads the minified shape, a spread list and both branches of a choice', async () => {
    const minified = await worker(
      '(()=>{let e="shared/wanted.js",l="shared/unwanted.js";importScripts(e),console.log("ready",e,l)})();'
    )
    expect(minified.emitted.has('background/shared/wanted.js')).toBe(true)
    expect(minified.emitted.has('background/shared/unwanted.js')).toBe(false)

    const spread = await worker(
      'const LIBS = ["shared/wanted.js", "shared/also.js"]\nconst UNWANTED = "shared/unwanted.js"\n' +
        'importScripts(...LIBS)\nconsole.log(UNWANTED)\n'
    )
    expect(spread.emitted.has('background/shared/wanted.js')).toBe(true)
    expect(spread.emitted.has('background/shared/also.js')).toBe(true)
    expect(spread.emitted.has('background/shared/unwanted.js')).toBe(false)

    const choice = await worker(
      'const A = "shared/wanted.js"\nconst B = "shared/also.js"\nconst UNWANTED = "shared/unwanted.js"\n' +
        'importScripts(globalThis.flag ? A : B)\nconsole.log(UNWANTED)\n'
    )
    expect(choice.emitted.has('background/shared/wanted.js')).toBe(true)
    expect(choice.emitted.has('background/shared/also.js')).toBe(true)
    expect(choice.emitted.has('background/shared/unwanted.js')).toBe(false)
  })

  it('still ships every listed path when the variable cannot be known', async () => {
    for (const code of [
      'let path = "shared/wanted.js"\nif (globalThis.flag) path = "shared/also.js"\nconst UNWANTED = "shared/unwanted.js"\nimportScripts(path)\n',
      'const WANTED = "shared/wanted.js"\nconst UNWANTED = "shared/unwanted.js"\nimportScripts(WANTED)\nimportScripts(pick())\n',
      'const WANTED = "shared/" + "wanted.js"\nconst UNWANTED = "shared/unwanted.js"\nconst ALSO = "shared/wanted.js"\nimportScripts(WANTED)\n',
      'function load(path) {\n  importScripts(path)\n}\nconst path = "shared/also.js"\nload("shared/wanted.js")\nload("shared/unwanted.js")\n'
    ]) {
      const {emitted} = await worker(code)

      expect(emitted.has('background/shared/wanted.js')).toBe(true)
      expect(emitted.has('background/shared/unwanted.js')).toBe(true)
    }
  })
})

describe('a path a constant names that is no file', () => {
  it('warns as the literal does when a bundle injects through a constant', async () => {
    const projectDir = createTempProject({})
    const literal = await runTrace(projectDir, {
      'background/service_worker.js':
        'chrome.scripting.executeScript({target: {tabId: 1}, files: ["inject/gone.js"]});'
    })
    const constant = await runTrace(projectDir, {
      'background/service_worker.js':
        '(()=>{let e="inject/gone.js";chrome.scripting.executeScript({target:{tabId:1},files:[e]}),console.log(e)})();'
    })

    expect(literal.compilation.warnings).toHaveLength(1)
    expect(constant.compilation.warnings).toHaveLength(1)
    expect(constant.compilation.warnings[0].name).toBe(
      literal.compilation.warnings[0].name
    )

    expect(constant.compilation.warnings[0].name).toBe(
      'InjectedScriptFilesMissing'
    )

    expect(String(constant.compilation.warnings[0].message)).toBe(
      String(literal.compilation.warnings[0].message)
    )
  })

  it('warns, naming the source, when an imported constant names no file', async () => {
    const projectDir = createTempProject({
      'src/background.ts':
        'import {GONE, GROUPS} from "./paths"\n' +
        'chrome.scripting.executeScript({target: {tabId: 1}, files: [GONE]})\n' +
        'chrome.scripting.registerContentScripts(GROUPS)\n',
      'src/paths.ts':
        'export const GONE = "inject/gone.js"\n' +
        'export const GROUPS = [{id: "g", js: ["inject/lost.js"], matches: ["<all_urls>"]}]\n'
    })
    const {compilation, emitted} = await runTrace(
      projectDir,
      {
        'background/service_worker.js':
          'chrome.scripting.executeScript({target: {tabId: 1}, files: [_paths__WEBPACK_IMPORTED_MODULE_0__.GONE]});'
      },
      undefined,
      undefined,
      ['src/background.ts', 'src/paths.ts']
    )

    expect(emitted.has('inject/gone.js')).toBe(false)
    expect(
      compilation.warnings.map((warning: any) => [warning.name, warning.file])
    ).toEqual([
      ['InjectedScriptFilesMissing', 'src/background.ts'],
      ['InjectedScriptFilesMissing', 'src/background.ts']
    ])

    expect(String(compilation.warnings[0].message)).toContain(
      "src/background.ts injects 'inject/gone.js'"
    )

    expect(String(compilation.warnings[1].message)).toContain(
      "injects 'inject/lost.js'"
    )
  })

  it('warns as the literal does when importScripts reads a constant', async () => {
    const run = (code: string) =>
      runTrace(
        createTempProject(
          {'background.js': '', 'shared/other.js': 'var OTHER = 1\n'},
          {background: {service_worker: 'background.js'}}
        ),
        {'background/service_worker.js': code}
      )
    const literal = await run('importScripts("shared/gone.js")')
    const constant = await run(
      'const GONE = "shared/gone.js"\nconst OTHER = "shared/other.js"\nimportScripts(GONE)\nconsole.log(OTHER)\n'
    )

    expect(literal.compilation.warnings).toHaveLength(1)
    expect(constant.compilation.warnings).toHaveLength(1)
    expect(constant.compilation.warnings[0].name).toBe(
      'ImportScriptsDependencyMissing'
    )

    expect(String(constant.compilation.warnings[0].message)).toBe(
      String(literal.compilation.warnings[0].message)
    )

    // A path that is only a guess still says nothing when it is no file.
    const guess = await run(
      'const GONE = "shared/gone.js"\nimportScripts(pick(GONE))\n'
    )
    expect(guess.compilation.warnings).toHaveLength(0)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  extractInjectedFileLiterals,
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

function makeCompilation(assets: Record<string, string>) {
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
    options: {entry: {}},
    hooks: {
      thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
    }
  }
  return {compiler, compilation, emitted}
}

async function runTrace(
  projectDir: string,
  assets: Record<string, string>,
  browser?: string
) {
  const made = makeCompilation(assets)
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

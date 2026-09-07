import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
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

function createTempProject(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-trace-'))
  tempDirs.push(dir)
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'fixture'}),
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
    fileDependencies: new Set<string>(),
    getAsset: (name: string) => emitted.get(name),
    getAssets: () => Array.from(emitted.values()),
    emitAsset: (name: string, source: any) => {
      emitted.set(name, {name, source})
    },
    hooks: {
      processAssets: {tap: (_opts: any, fn: any) => fn()}
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

function runTrace(projectDir: string, assets: Record<string, string>) {
  const made = makeCompilation(assets)
  new TraceRuntimeLoadedFiles({
    manifestPath: path.join(projectDir, 'manifest.json')
  }).apply(made.compiler)
  return made
}

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
  it('warns once when an injection literal names the compiled source', () => {
    const projectDir = createTempProject({
      'scripts/ss.ts': 'export {}\n'
    })
    const {compilation, emitted} = runTrace(projectDir, {
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

  it('warns for a compiled source registered as a content script', () => {
    const projectDir = createTempProject({
      'scripts/one.tsx': 'export {}\n'
    })
    const {compilation} = runTrace(projectDir, {
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

  it('stays silent when the literal names the emitted path', () => {
    const projectDir = createTempProject({
      'scripts/ss.ts': 'export {}\n'
    })
    const {compilation} = runTrace(projectDir, {
      'background/service_worker.js':
        'chrome.scripting.executeScript({target: {tabId: 1}, files: ["scripts/ss.js"]});',
      'scripts/ss.js': 'console.log("compiled")'
    })

    expect(compilation.warnings).toHaveLength(0)
  })
})

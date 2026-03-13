import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, beforeEach, afterEach} from 'vitest'
import warnNoDefaultExport from '../steps/setup-reload-strategy/add-content-script-wrapper/warn-no-default-export'

function run(
  resourcePath: string,
  manifestPath: string,
  source: string,
  compilation?: any,
  resourceQuery?: string
) {
  const ctx: any = {
    resourcePath,
    resourceQuery,
    _compilation: compilation,
    getOptions() {
      return {manifestPath, browser: 'chrome', mode: 'development'}
    }
  }
  return warnNoDefaultExport.call(ctx, source)
}

describe('warn-no-default-export loader', () => {
  let tmp: string
  let manifestPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warn-default-'))
    manifestPath = path.join(tmp, 'manifest.json')
  })

  afterEach(() => {
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  it('warns for scripts/ folder files without default export', () => {
    const scriptsDir = path.join(tmp, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})
    const scriptFile = path.join(scriptsDir, 'hello.ts')
    fs.writeFileSync(scriptFile, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )

    const compilation: any = {warnings: []}
    const src = `export const x = 1`
    run(scriptFile, manifestPath, src, compilation)
    expect(compilation.warnings.length).toBe(1)
    const msg = String(compilation.warnings[0])
    expect(msg).toContain('Content script requires a default export.')
    expect(msg).toContain(
      'Export a default function so Extension.js can mount and cleanup safely.'
    )
    expect(msg).toMatch(
      /See (TypeScript|vanilla JS|React|Vue|Svelte|Preact) sample/
    )
  })

  it('warns when default export is a class (scripts/ folder)', () => {
    const scriptsDir = path.join(tmp, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})
    const scriptFile = path.join(scriptsDir, 'hello.ts')
    fs.writeFileSync(scriptFile, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )

    const compilation: any = {warnings: []}
    const src = `export default class App { start(){} }`
    run(scriptFile, manifestPath, src, compilation)
    expect(compilation.warnings.length).toBe(1)
    expect(String(compilation.warnings[0])).toContain(
      'Content script default export must be a function.'
    )
    expect(String(compilation.warnings[0])).toContain('Found: class')
  })

  it('warns when default export resolves to a class identifier (scripts/ folder)', () => {
    const scriptsDir = path.join(tmp, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})
    const scriptFile = path.join(scriptsDir, 'hello.ts')
    fs.writeFileSync(scriptFile, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )

    const compilation: any = {warnings: []}
    const src = `class App {}\nexport default App\n`
    run(scriptFile, manifestPath, src, compilation)
    expect(compilation.warnings.length).toBe(1)
    expect(String(compilation.warnings[0])).toContain(
      'Content script default export must be a function.'
    )
    expect(String(compilation.warnings[0])).toContain('Found: class')
  })

  it('includes React sample link when project has react dependency', () => {
    const pkgPath = path.join(tmp, 'package.json')
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({dependencies: {react: '^18.0.0'}})
    )
    const scriptsDir = path.join(tmp, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})
    const scriptFile = path.join(scriptsDir, 'hello.tsx')
    fs.writeFileSync(scriptFile, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.tsx']}], background: {}})
    )

    const compilation: any = {warnings: []}
    const src = `export const x = 1`
    run(scriptFile, manifestPath, src, compilation)
    expect(compilation.warnings.length).toBe(1)
    const msg = String(compilation.warnings[0])
    expect(msg).toContain('See React sample')
    expect(msg).toContain('react/src/content/scripts.tsx')
  })

  it('does not warn when default export is a function identifier (scripts/ folder)', () => {
    const scriptsDir = path.join(tmp, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})
    const scriptFile = path.join(scriptsDir, 'hello.ts')
    fs.writeFileSync(scriptFile, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )

    const compilation: any = {warnings: []}
    const src = `const init = () => {}\nexport default init\n`
    run(scriptFile, manifestPath, src, compilation)
    expect(compilation.warnings.length).toBe(0)
  })
})

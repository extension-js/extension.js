import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, beforeEach, afterEach, vi} from 'vitest'
import wrapperLoader from '../steps/setup-reload-strategy/add-content-script-wrapper/content-script-wrapper'

function run(
  resourcePath: string,
  manifestPath: string,
  source: string,
  resourceQuery?: string
) {
  const ctx: any = {
    resourcePath,
    resourceQuery,
    getOptions() {
      return {manifestPath, browser: 'chrome', mode: 'production'}
    }
  }
  return wrapperLoader.call(ctx, source)
}

function runDevProxy(
  resourcePath: string,
  manifestPath: string,
  source: string
) {
  const ctx: any = {
    resourcePath,
    resourceQuery: '',
    getOptions() {
      return {manifestPath, browser: 'chrome', mode: 'development'}
    },
    emitWarning: vi.fn()
  }
  return wrapperLoader.call(ctx, source)
}

describe('content-script-wrapper loader', () => {
  let tmp: string
  let manifestPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-wrapper-'))
    manifestPath = path.join(tmp, 'manifest.json')
  })

  afterEach(() => {
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  it('wraps declared content script with runtime and preserves default export (inner request)', () => {
    const cs = path.join(tmp, 'cs.ts')
    fs.writeFileSync(cs, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )
    const out = run(
      cs,
      manifestPath,
      'export default function initial(){ return ()=>{} }',
      '?__extjs_inner=1'
    ) as string
    expect(out).toMatch('function __EXTENSIONJS_mountWithHMR(')
    expect(out).toMatch('/* __EXTENSIONJS_MOUNT_WRAPPED__ */')
    expect(out).toMatch(
      /try \{ __EXTENSIONJS_mountWithHMR\(__EXTENSIONJS_default__\) \} catch \([^)]+\) \{\}/
    )
    expect(out).toMatch('export default __EXTENSIONJS_default__')
  })

  it('dev proxy blocks dev-server reload fallback (non-extension pages)', () => {
    const cs = path.join(tmp, 'cs.ts')
    fs.writeFileSync(cs, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )
    const out = runDevProxy(
      cs,
      manifestPath,
      'export default function x(){}'
    ) as string
    expect(out).toMatch('Object.getPrototypeOf')
    expect(out).toMatch('__extjsProto.reload')
    expect(out).toMatch('blocked HMR-triggered location.reload')
  })

  it('is a no-op for non-declared files', () => {
    const other = path.join(tmp, 'other.ts')
    fs.writeFileSync(other, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )
    const src = 'export default function x(){ return ()=>{} }'
    const out = run(other, manifestPath, src) as string
    expect(out).toBe(src)
  })

  it('wraps scripts/ folder scripts even when not declared in manifest (inner request)', () => {
    const scriptsDir = path.join(tmp, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})
    const scriptFile = path.join(scriptsDir, 'hello.ts')
    fs.writeFileSync(scriptFile, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )
    const out = run(
      scriptFile,
      manifestPath,
      'export default function initial(){ return ()=>{} }',
      '?__extjs_inner=1'
    ) as string
    expect(out).toMatch('function __EXTENSIONJS_mountWithHMR(')
    expect(out).toMatch('/* __EXTENSIONJS_MOUNT_WRAPPED__ */')
    expect(out).toMatch('export default __EXTENSIONJS_default__')
  })

  it('injects CSS accepts for side-effect CSS imports (inner request)', () => {
    const cs = path.join(tmp, 'cs.ts')
    fs.writeFileSync(cs, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )
    const src = `\nimport './styles.css'\nexport default function m(){}`
    const out = run(cs, manifestPath, src, '?__extjs_inner=1') as string
    expect(out).toMatch('webpackHot.accept("./styles.css"')
    expect(out).toMatch('__EXTENSIONJS_CSS_UPDATE__')
  })

  it('injects CSS accepts for default CSS imports (inner request)', () => {
    const cs = path.join(tmp, 'cs.ts')
    fs.writeFileSync(cs, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )
    const src = `\nimport url from './a.css'\nimport b from './b.scss'\nexport default function m(){}`
    const out = run(cs, manifestPath, src, '?__extjs_inner=1') as string
    expect(out).toMatch('webpackHot.accept("./a.css"')
    expect(out).toMatch('webpackHot.accept("./b.scss"')
  })

  it('strips direct call to default-exported function to avoid double mount (inner request)', () => {
    const cs = path.join(tmp, 'cs.ts')
    fs.writeFileSync(cs, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )
    const src = `\nfunction initial(){ return ()=>{} }\nexport default initial\ninitial()\n`
    const out = run(cs, manifestPath, src, '?__extjs_inner=1') as string
    expect(out).toMatch('export default __EXTENSIONJS_default__')
    expect(out).toMatch('__EXTENSIONJS_mountWithHMR(__EXTENSIONJS_default__)')
    expect(out).not.toMatch(/(^|\n|;)\s*initial\s*\(\s*\)\s*;?\s*(?=\n|$)/)
  })

  it('does not inject when default export is missing (inner request)', () => {
    const cs = path.join(tmp, 'cs.ts')
    fs.writeFileSync(cs, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )
    const src = `export const x = 1`
    const out = run(cs, manifestPath, src, '?__extjs_inner=1') as string
    expect(out).toBe(src)
  })

  it('emits a warning when stripping a direct default call invocation (inner request)', () => {
    const cs = path.join(tmp, 'cs.ts')
    fs.writeFileSync(cs, '')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({content_scripts: [{js: ['cs.ts']}], background: {}})
    )
    const ctx: any = {
      resourcePath: cs,
      resourceQuery: '?__extjs_inner=1',
      getOptions() {
        return {manifestPath, browser: 'chrome', mode: 'development'}
      },
      emitWarning: vi.fn()
    }
    const src = `\nfunction init(){ return ()=>{} }\nexport default init\ninit()\n`
    const out = (wrapperLoader as any).call(ctx, src) as string
    expect(out).toMatch('export default __EXTENSIONJS_default__')
    expect(ctx.emitWarning).toHaveBeenCalled()
  })
})

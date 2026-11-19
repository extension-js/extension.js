import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../../plugin-web-extension/feature-scripts/contracts'
import {HtmlPlugin} from '../index'

// Only the module rules are read here, so the hooks take a tap and never
// run it: the steps behind them have their own specs.
function makeCompiler(mode: 'development' | 'production') {
  const rules: any[] = []
  const tap = {tap: () => {}, tapAsync: () => {}}

  return {
    options: {mode, module: {rules}},
    hooks: {
      thisCompilation: tap,
      compilation: tap,
      make: tap,
      watchRun: tap,
      done: tap
    }
  } as any
}

// Scratch projects live under the OS temp dir, so a crashed run leaves no
// litter in the source tree.
const tmpRoots: string[] = []

function makeTmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  tmpRoots.push(dir)

  return dir
}

afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, {recursive: true, force: true})
})

// A project with one page that names one script, the smallest shape that
// earns the page HMR rule.
function writePageProject(prefix: string, manifest: Record<string, unknown>) {
  const tmp = fs.realpathSync(makeTmp(prefix))
  const manifestPath = path.join(tmp, 'manifest.json')
  const pagePath = path.join(tmp, 'popup', 'index.html')
  fs.mkdirSync(path.dirname(pagePath), {recursive: true})
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')
  fs.writeFileSync(
    pagePath,
    '<!doctype html><html><body><script src="./main.js"></script></body></html>',
    'utf8'
  )

  fs.writeFileSync(path.join(tmp, 'popup', 'main.js'), 'console.log(1)\n')
  fs.writeFileSync(path.join(tmp, 'background.js'), 'console.log(2)\n')

  return {tmp, manifestPath, pagePath}
}

function pageHmrRuleOf(compiler: any) {
  return compiler.options.module.rules.find((rule: any) =>
    Array.isArray(rule?.use)
      ? rule.use.some((entry: any) =>
          String(entry?.loader || '').includes('ensure-hmr-for-scripts')
        )
      : false
  )
}

describe('HtmlPlugin', () => {
  it('adds the page HMR loader in a dev session and not in a production build', () => {
    const {tmp, manifestPath, pagePath} = writePageProject(
      'extjs-html-plugin',
      {name: 'x'}
    )

    const dev = makeCompiler('development')
    dev.options.context = tmp
    new HtmlPlugin({
      manifestPath,
      includeList: {'action/index': pagePath}
    } as any).apply(dev as any)

    expect(pageHmrRuleOf(dev)).toBeTruthy()

    const production = makeCompiler('production')
    production.options.context = tmp
    new HtmlPlugin({
      manifestPath,
      includeList: {'action/index': pagePath}
    } as any).apply(production as any)

    expect(pageHmrRuleOf(production)).toBeUndefined()
  })

  it('scopes the page HMR loader to the scripts a page names', () => {
    const {tmp, manifestPath, pagePath} = writePageProject(
      'extjs-html-plugin-scope',
      {
        name: 'x',
        background: {service_worker: 'background.js'},
        content_scripts: [{js: ['content.ts']}]
      }
    )

    const compiler = makeCompiler('development')
    compiler.options.context = tmp
    new HtmlPlugin({
      manifestPath,
      includeList: {'action/index': pagePath}
    } as any).apply(compiler as any)

    const pageHmrRule = pageHmrRuleOf(compiler)

    expect(pageHmrRule?.issuerLayer).toEqual({
      not: EXTENSIONJS_CONTENT_SCRIPT_LAYER
    })

    // Only an entry accepts its own update, an imported module bubbles to it.
    expect(pageHmrRule?.issuer('')).toBe(true)
    expect(pageHmrRule?.issuer(path.join(tmp, 'popup', 'main.js'))).toBe(false)

    // A background script sits in the same project and has no page to
    // redraw, so only the file the page names is inside the rule.
    expect(pageHmrRule?.include(path.join(tmp, 'popup', 'main.js'))).toBe(true)
    expect(pageHmrRule?.include(path.join(tmp, 'background.js'))).toBe(false)
    expect(pageHmrRule?.include(path.join(tmp, 'popup', 'other.js'))).toBe(
      false
    )

    expect(
      pageHmrRule?.exclude?.some(
        (entry: unknown) => typeof entry === 'function'
      )
    ).toBe(true)
  })

  it('registers no page HMR loader when a framework owns refresh or no page has a script', () => {
    const framework = writePageProject('extjs-html-plugin-react', {name: 'x'})
    fs.writeFileSync(
      path.join(framework.tmp, 'package.json'),
      JSON.stringify({name: 'x', dependencies: {react: '19.0.0'}})
    )

    const withFramework = makeCompiler('development')
    withFramework.options.context = framework.tmp
    new HtmlPlugin({
      manifestPath: framework.manifestPath,
      includeList: {'action/index': framework.pagePath}
    } as any).apply(withFramework as any)

    expect(pageHmrRuleOf(withFramework)).toBeUndefined()

    const bare = writePageProject('extjs-html-plugin-bare', {name: 'x'})
    fs.writeFileSync(
      bare.pagePath,
      '<!doctype html><html><body><h1>no script</h1></body></html>'
    )

    const withoutScripts = makeCompiler('development')
    withoutScripts.options.context = bare.tmp
    new HtmlPlugin({
      manifestPath: bare.manifestPath,
      includeList: {'action/index': bare.pagePath}
    } as any).apply(withoutScripts as any)

    expect(pageHmrRuleOf(withoutScripts)).toBeUndefined()
  })

  it('scopes the page HMR loader away from browser-prefixed content entries', () => {
    const cases: Array<[string, string, boolean]> = [
      ['firefox:content_scripts', 'firefox', true],
      ['chromium:content_scripts', 'edge', true],
      ['chrome:content_scripts', 'chrome', true],
      ['chrome:content_scripts', 'edge', false],
      ['firefox:content_scripts', 'chrome', false]
    ]

    for (const [key, browser, excluded] of cases) {
      const {tmp, manifestPath, pagePath} = writePageProject(
        `extjs-html-plugin-${browser}-${excluded}`,
        {name: 'x', [key]: [{js: ['content.ts']}]}
      )

      const compiler = makeCompiler('development')
      compiler.options.context = tmp
      new HtmlPlugin({
        manifestPath,
        browser,
        includeList: {'action/index': pagePath}
      } as any).apply(compiler as any)

      const pageHmrRule = pageHmrRuleOf(compiler)
      const excludeFn = pageHmrRule?.exclude?.find(
        (entry: unknown) => typeof entry === 'function'
      ) as (resourcePath: string) => boolean

      expect(excludeFn(path.join(tmp, 'content.ts'))).toBe(excluded)
      fs.rmSync(tmp, {recursive: true, force: true})
    }
  })
})

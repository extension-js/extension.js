import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../plugin-web-extension/feature-scripts/contracts'
import {
  type HtmlPage,
  htmlPagesExtensionsFor
} from '../../plugin-web-extension/shared/html-page-extensions'
import {SetupPageReload} from '../steps/setup-page-reload'

const compilers: Compiler[] = []

afterAll(async () => {
  for (const compiler of compilers) {
    await new Promise((resolve) => compiler.close(() => resolve(null)))
  }
})

// A real compiler that never runs: the step reads and writes its options.
function makeCompiler(
  mode: 'development' | 'production',
  context: string,
  extra: Record<string, unknown> = {}
) {
  const compiler = rspack({mode, context, entry: {}, ...extra})

  compilers.push(compiler)

  return compiler
}

// Declares the pages the way the pages plugin does: each one gets its entry,
// then every registered extension is told.
function declarePages(
  compiler: Compiler,
  options: ConstructorParameters<typeof SetupPageReload>[0],
  pages: HtmlPage[]
) {
  new SetupPageReload(options).apply(compiler)

  const entries = compiler.options.entry as Record<string, {import: string[]}>

  for (const page of pages) entries[page.entry] = {import: [...page.scripts]}

  for (const extension of htmlPagesExtensionsFor(compiler)) {
    extension.pagesDeclared(compiler, pages)
  }
}

function importsOf(compiler: Compiler, entry: string): string[] {
  return (compiler.options.entry as Record<string, {import: string[]}>)[
    entry
  ].import.map((file) => file.replace(/\\/g, '/'))
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

  const page: HtmlPage = {
    entry: 'action/index',
    file: pagePath,
    scripts: [path.join(tmp, 'popup', 'main.js')]
  }

  return {tmp, manifestPath, pagePath, page}
}

function pageHmrRuleOf(compiler: Compiler): any {
  return (compiler.options.module.rules as any[]).find((rule: any) =>
    Array.isArray(rule?.use)
      ? rule.use.some((entry: any) =>
          String(entry?.loader || '').includes('ensure-hmr-for-scripts')
        )
      : false
  )
}

describe('the page HMR rule', () => {
  it('adds the page HMR loader in a dev session and not in a production build', () => {
    const {tmp, manifestPath, page} = writePageProject('extjs-html-plugin', {
      name: 'x'
    })

    const dev = makeCompiler('development', tmp)
    declarePages(dev, {manifestPath}, [page])

    expect(pageHmrRuleOf(dev)).toBeTruthy()

    const production = makeCompiler('production', tmp)
    declarePages(production, {manifestPath}, [page])

    expect(pageHmrRuleOf(production)).toBeUndefined()
  })

  it('follows the session over the mode when the config names one', () => {
    const {tmp, manifestPath, page} = writePageProject('extjs-page-session', {
      name: 'x'
    })

    const shippable = makeCompiler('development', tmp)
    declarePages(shippable, {manifestPath, devSession: false}, [page])

    expect(pageHmrRuleOf(shippable)).toBeUndefined()
  })

  it('scopes the page HMR loader to the scripts a page names', () => {
    const {tmp, manifestPath, page} = writePageProject(
      'extjs-html-plugin-scope',
      {
        name: 'x',
        background: {service_worker: 'background.js'},
        content_scripts: [{js: ['content.ts']}]
      }
    )

    const compiler = makeCompiler('development', tmp)
    declarePages(compiler, {manifestPath}, [page])

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

    const withFramework = makeCompiler('development', framework.tmp)
    declarePages(withFramework, {manifestPath: framework.manifestPath}, [
      framework.page
    ])

    expect(pageHmrRuleOf(withFramework)).toBeUndefined()

    const bare = writePageProject('extjs-html-plugin-bare', {name: 'x'})

    const withoutScripts = makeCompiler('development', bare.tmp)
    declarePages(withoutScripts, {manifestPath: bare.manifestPath}, [
      {...bare.page, scripts: []}
    ])

    expect(pageHmrRuleOf(withoutScripts)).toBeUndefined()
  })

  it('scopes the page HMR loader away from browser-prefixed content entries', () => {
    const cases: Array<[string, 'firefox' | 'edge' | 'chrome', boolean]> = [
      ['firefox:content_scripts', 'firefox', true],
      ['chromium:content_scripts', 'edge', true],
      ['chrome:content_scripts', 'chrome', true],
      ['chrome:content_scripts', 'edge', false],
      ['firefox:content_scripts', 'chrome', false]
    ]

    for (const [key, browser, excluded] of cases) {
      const {tmp, manifestPath, page} = writePageProject(
        `extjs-html-plugin-${browser}-${excluded}`,
        {name: 'x', [key]: [{js: ['content.ts']}]}
      )

      const compiler = makeCompiler('development', tmp)
      declarePages(compiler, {manifestPath, browser}, [page])

      const pageHmrRule = pageHmrRuleOf(compiler)
      const excludeFn = pageHmrRule?.exclude?.find(
        (entry: unknown) => typeof entry === 'function'
      ) as (resourcePath: string) => boolean

      expect(excludeFn(path.join(tmp, 'content.ts'))).toBe(excluded)
      fs.rmSync(tmp, {recursive: true, force: true})
    }
  })
})

describe('the hot update client of a page entry', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // No host or port of a session a parent process left in the environment.
  function withoutSessionEnv() {
    for (const name of ['HOST', 'PORT', 'PATH', 'PROTOCOL']) {
      vi.stubEnv(`EXTENSION_DEV_SERVER_${name}`, undefined)
    }
  }

  const devServer = {host: '127.0.0.1', port: 8080, hot: 'only'}

  it('wraps the page files of a development build, shim first and the minimum script last', () => {
    withoutSessionEnv()
    const {tmp, manifestPath, page} = writePageProject('extjs-page-client', {
      name: 'x'
    })
    const compiler = makeCompiler('development', tmp, {devServer})

    declarePages(compiler, {manifestPath}, [page])

    const imports = importsOf(compiler, 'action/index')

    expect(imports).toHaveLength(5)
    expect(imports[0]).toMatch(/\/preact-refresh-shim(\.m?js)?$/)
    expect(imports[1]).toContain('@rspack/dev-server/client/index.js?')
    expect(imports[2]).toMatch(/@rspack\/core\/hot\/dev-server(\.js)?$/)
    expect(imports[3]).toMatch(/\/popup\/main\.js$/)
    expect(imports[4]).toMatch(/\/minimum-script-file(\.m?js)?$/)
  })

  it('gives a page with no script the shim and the minimum script alone', () => {
    withoutSessionEnv()
    const {tmp, manifestPath, page} = writePageProject('extjs-page-bare', {
      name: 'x'
    })
    const compiler = makeCompiler('development', tmp)

    declarePages(compiler, {manifestPath}, [{...page, scripts: []}])

    const imports = importsOf(compiler, 'action/index')

    expect(imports).toHaveLength(2)
    expect(imports[0]).toMatch(/\/preact-refresh-shim(\.m?js)?$/)
    expect(imports[1]).toMatch(/\/minimum-script-file(\.m?js)?$/)
  })

  it('reads the session from the environment when the config names no dev server', () => {
    withoutSessionEnv()
    vi.stubEnv('EXTENSION_DEV_SERVER_HOST', '127.0.0.1')
    vi.stubEnv('EXTENSION_DEV_SERVER_PORT', '9090')
    const {tmp, manifestPath, page} = writePageProject('extjs-page-env', {
      name: 'x'
    })
    const compiler = makeCompiler('development', tmp)

    declarePages(compiler, {manifestPath}, [page])

    const client = importsOf(compiler, 'action/index').find((file) =>
      file.includes('@rspack/dev-server/client/index.js?')
    )

    expect(new URLSearchParams(client?.split('?')[1]).get('port')).toBe('9090')
  })

  it('names the port and host of its own session over the environment', () => {
    withoutSessionEnv()
    vi.stubEnv('EXTENSION_DEV_SERVER_HOST', '127.0.0.1')
    vi.stubEnv('EXTENSION_DEV_SERVER_PORT', '9090')
    const {tmp, manifestPath, page} = writePageProject('extjs-page-own', {
      name: 'x'
    })
    const compiler = makeCompiler('development', tmp)

    declarePages(
      compiler,
      {manifestPath, port: 9191, connectableHost: 'dev.test'},
      [page]
    )

    const query = new URLSearchParams(
      importsOf(compiler, 'action/index')
        .find((file) => file.includes('@rspack/dev-server/client/index.js?'))
        ?.split('?')[1]
    )

    expect(query.get('port')).toBe('9191')
    expect(query.get('hostname')).toBe('dev.test')
  })

  it('points the stock dev socket file at the class that names the page', () => {
    withoutSessionEnv()
    const {tmp, manifestPath, page} = writePageProject('extjs-page-socket', {
      name: 'x'
    })
    const compiler = makeCompiler('development', tmp, {
      devServer,
      resolve: {alias: {kept: '/kept'}}
    })

    declarePages(compiler, {manifestPath}, [page])

    const alias = compiler.options.resolve.alias as Record<string, string>
    const keys = Object.keys(alias).filter((key) => key !== 'kept')

    expect(alias.kept).toBe('/kept')
    expect(keys).toHaveLength(1)
    expect(keys[0].replace(/\\/g, '/')).toMatch(
      /@rspack\/dev-server\/client\/clients\/WebSocketClient\.js\$$/
    )

    expect(alias[keys[0]].replace(/\\/g, '/')).toMatch(
      /page-socket-client(\.m?js)?$/
    )
  })

  it('leaves the entries and the socket alone in a production build', () => {
    withoutSessionEnv()
    const {tmp, manifestPath, page} = writePageProject('extjs-page-prod', {
      name: 'x'
    })
    const compiler = makeCompiler('production', tmp, {devServer})

    declarePages(compiler, {manifestPath}, [page])

    expect(importsOf(compiler, 'action/index')).toEqual([
      page.scripts[0].replace(/\\/g, '/')
    ])

    expect(compiler.options.resolve.alias ?? {}).toEqual({})
  })

  // A development build that ships is not a session: its pages carry what
  // the author wrote, as a production build's do.
  it('leaves the entries, the socket and the rules alone in a development build that ships', () => {
    withoutSessionEnv()
    const {tmp, manifestPath, page} = writePageProject('extjs-page-ships', {
      name: 'x'
    })
    const compiler = makeCompiler('development', tmp, {devServer})

    declarePages(compiler, {manifestPath, devSession: false}, [page])

    expect(importsOf(compiler, 'action/index')).toEqual([
      page.scripts[0].replace(/\\/g, '/')
    ])

    expect(compiler.options.resolve.alias ?? {}).toEqual({})
    expect(pageHmrRuleOf(compiler)).toBeUndefined()
  })

  it('does the same in a session started with EXTENSION_NO_RELOAD', () => {
    withoutSessionEnv()
    vi.stubEnv('EXTENSION_NO_RELOAD', 'true')
    const {tmp, manifestPath, page} = writePageProject('extjs-page-off', {
      name: 'x'
    })
    const compiler = makeCompiler('development', tmp, {devServer})

    declarePages(compiler, {manifestPath, devSession: true}, [page])

    expect(importsOf(compiler, 'action/index')).toEqual([
      page.scripts[0].replace(/\\/g, '/')
    ])

    expect(compiler.options.resolve.alias ?? {}).toEqual({})
    expect(pageHmrRuleOf(compiler)).toBeUndefined()
  })

  it('adds no client when no session is named anywhere', () => {
    withoutSessionEnv()
    const {tmp, manifestPath, page} = writePageProject('extjs-page-none', {
      name: 'x'
    })
    const compiler = makeCompiler('development', tmp)

    declarePages(compiler, {manifestPath}, [page])

    expect(
      importsOf(compiler, 'action/index').some((file) =>
        file.includes('dev-server')
      )
    ).toBe(false)

    expect(compiler.options.resolve.alias ?? {}).toEqual({})
  })
})

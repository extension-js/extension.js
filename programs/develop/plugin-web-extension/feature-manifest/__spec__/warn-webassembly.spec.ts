import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {setOriginalManifestContent} from '../manifest-lib/manifest'
import {
  findRemoteWebAssemblyAddresses,
  policyRunsWebAssembly,
  WASM_PAGES_POLICY,
  WarnWebAssembly
} from '../steps/warn-webassembly'
import {buildProject} from '../../../__spec__/helpers/build-project'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// Larger than the asset inline threshold, so the file cannot become a data URI.
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
const WASM_BYTES = Buffer.concat([WASM_MAGIC, Buffer.alloc(4096, 0)])

const PACKAGED_PAGE = [
  'const url = new URL("./codec.wasm", import.meta.url)',
  'WebAssembly.instantiateStreaming(fetch(url)).then(console.log)',
  ''
].join('\n')

const LOCATE_FILE_WORKER = [
  'import initSqlJs from "./sql-stub.js"',
  'initSqlJs({',
  '  locateFile: (file) => "https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/" + file',
  '})',
  ''
].join('\n')

const SQL_STUB = [
  'export default function initSqlJs(Module) {',
  '  const file = "sql-wasm.wasm"',
  '  return fetch(Module["locateFile"] ? Module["locateFile"](file) : file)',
  '}',
  ''
].join('\n')

function project(options: {
  manifest?: Record<string, unknown>
  page?: string
  worker?: string
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-wasm-warn-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'wasm-warn', version: '0.0.0'})
  )

  fs.mkdirSync(path.join(root, 'page'))
  fs.writeFileSync(path.join(root, 'page', 'codec.wasm'), WASM_BYTES)
  fs.writeFileSync(
    path.join(root, 'page', 'index.html'),
    '<!doctype html><html><body><script src="./page.js"></script></body></html>'
  )

  fs.writeFileSync(
    path.join(root, 'page', 'page.js'),
    options.page ?? 'console.log("page")\n'
  )

  fs.writeFileSync(path.join(root, 'sql-stub.js'), SQL_STUB)
  fs.writeFileSync(
    path.join(root, 'background.js'),
    options.worker ?? 'console.log("worker")\n'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'wasm-warn',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      options_page: 'page/index.html',
      ...options.manifest
    })
  )

  return root
}

async function build(root: string, browser = 'chrome') {
  return await buildProject(root, {
    browser,
    mode: 'production',
    exitOnError: false
  })
}

const policyWarnings = (summary: {warnings?: string[]}) =>
  (summary.warnings || []).filter((text) =>
    text.includes('The build emits WebAssembly')
  )

const remoteWarnings = (summary: {warnings?: string[]}) =>
  (summary.warnings || []).filter((text) =>
    text.includes('fetches WebAssembly from another origin')
  )

describe('a build that emits WebAssembly', () => {
  it('names the binary and the policy value when the manifest has no policy', async () => {
    const summary = await build(project({page: PACKAGED_PAGE}))

    expect(summary.errors_count).toBe(0)
    const warnings = policyWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/FILE assets\/codec\.[0-9a-f]+\.wasm/)
    expect(warnings[0]).toContain('content_security_policy.extension_pages')
    expect(warnings[0]).toContain(
      "VALUE script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    )

    expect(remoteWarnings(summary)).toEqual([])
  })

  it('warns on a Firefox build too', async () => {
    const summary = await build(project({page: PACKAGED_PAGE}), 'firefox')

    expect(summary.errors_count).toBe(0)
    expect(policyWarnings(summary)).toHaveLength(1)
    expect(policyWarnings(summary)[0]).toContain('firefox')
  })

  it('stays quiet when the pages policy already lists the keyword', async () => {
    const summary = await build(
      project({
        page: PACKAGED_PAGE,
        manifest: {
          content_security_policy: {extension_pages: WASM_PAGES_POLICY}
        }
      })
    )

    expect(summary.errors_count).toBe(0)
    expect(policyWarnings(summary)).toEqual([])
    expect(remoteWarnings(summary)).toEqual([])
  })

  it('stays quiet when no binary is emitted', async () => {
    const summary = await build(project({}))

    expect(summary.errors_count).toBe(0)
    expect(policyWarnings(summary)).toEqual([])
    expect(remoteWarnings(summary)).toEqual([])
  })
})

describe('built code that fetches WebAssembly from another origin', () => {
  it('names the source file and the address handed to locateFile', async () => {
    const summary = await build(project({worker: LOCATE_FILE_WORKER}))

    expect(summary.errors_count).toBe(0)
    const warnings = remoteWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      'FILE background.js ADDRESS https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/'
    )

    expect(warnings[0]).toContain('Ship the binary in the package')
    expect(policyWarnings(summary)).toEqual([])
  })

  it('names a literal remote .wasm address', async () => {
    const summary = await build(
      project({
        worker:
          'fetch("https://example.com/pkg/codec.wasm").then(console.log)\n'
      }),
      'firefox'
    )

    expect(summary.errors_count).toBe(0)
    const warnings = remoteWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      'FILE background.js ADDRESS https://example.com/pkg/codec.wasm'
    )
  })
})

describe('policyRunsWebAssembly', () => {
  const pages = (policy: string) => ({
    manifest_version: 3,
    content_security_policy: {extension_pages: policy}
  })

  it('reads the keyword from script-src, or from default-src without one', () => {
    expect(policyRunsWebAssembly(pages(WASM_PAGES_POLICY), 'chrome')).toBe(true)
    expect(
      policyRunsWebAssembly(
        pages("default-src 'self' 'wasm-unsafe-eval'"),
        'chrome'
      )
    ).toBe(true)

    expect(
      policyRunsWebAssembly(
        pages("default-src 'wasm-unsafe-eval'; script-src 'self'"),
        'chrome'
      )
    ).toBe(false)

    expect(
      policyRunsWebAssembly(
        pages("script-src 'self'; object-src 'self'"),
        'edge'
      )
    ).toBe(false)
  })

  it('takes no Manifest V2 keyword on Manifest V3', () => {
    expect(
      policyRunsWebAssembly(pages("script-src 'self' 'wasm-eval'"), 'chrome')
    ).toBe(false)

    expect(policyRunsWebAssembly({manifest_version: 3}, 'firefox')).toBe(false)
  })

  it('reads the Manifest V2 string on Chromium and lets Firefox through', () => {
    const mv2 = (policy?: string) => ({
      manifest_version: 2,
      ...(policy ? {content_security_policy: policy} : {})
    })

    expect(policyRunsWebAssembly(mv2(), 'chrome')).toBe(false)
    expect(
      policyRunsWebAssembly(mv2("script-src 'self' 'wasm-eval'"), 'chrome')
    ).toBe(true)

    expect(
      policyRunsWebAssembly(mv2("script-src 'self' 'unsafe-eval'"), 'chrome')
    ).toBe(true)

    expect(policyRunsWebAssembly(mv2(), 'firefox')).toBe(true)
  })
})

describe('findRemoteWebAssemblyAddresses', () => {
  it('finds a literal remote binary and a base handed to locateFile', () => {
    expect(
      findRemoteWebAssemblyAddresses(
        'fetch("https://cdn.example/a/zstd-wasm@1/zstd.wasm?v=2")'
      )
    ).toEqual(['https://cdn.example/a/zstd-wasm@1/zstd.wasm?v=2'])

    expect(
      findRemoteWebAssemblyAddresses(
        'init({locateFile:e=>`https://cdn.example/dist/${e}`})'
      )
    ).toEqual(['https://cdn.example/dist/'])
  })

  it('leaves packaged binaries, loopback hosts and other remote addresses', () => {
    for (const text of [
      'new URL("./codec.wasm", import.meta.url)',
      'fetch("http://localhost:8080/codec.wasm")',
      'fetch("https://example.com/api")',
      '// see https://example.com/docs/codec.wasm for the format',
      'Module["locateFile"]?Module["locateFile"](p,d):d+p;const docs="https://example.com/"',
      'const page = "https://example.com/wasm-guide"'
    ]) {
      expect(findRemoteWebAssemblyAddresses(text)).toEqual([])
    }
  })
})

describe('WarnWebAssembly in a dev session', () => {
  function session(mode: 'development' | 'production') {
    let thisCompilationFn: ((compilation: any) => void) | undefined

    const compiler: any = {
      options: {mode, context: os.tmpdir()},
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: any) => {
            thisCompilationFn = fn
          }
        }
      }
    }

    new WarnWebAssembly({browser: 'chrome'}).apply(compiler)

    return (wasmName: string) => {
      const warnings: any[] = []
      let processAssetsFn: (() => void) | undefined
      const compilation: any = {
        warnings,
        modules: [],
        getAssets: () => [
          {name: wasmName, source: {source: () => Buffer.alloc(8)}},
          {
            name: 'background/service_worker.js',
            source: {source: () => 'fetch("https://example.com/codec.wasm")'}
          }
        ],
        hooks: {
          processAssets: {
            tap: (_options: any, callback: any) => {
              processAssetsFn = callback
            }
          }
        }
      }
      setOriginalManifestContent(
        compilation,
        JSON.stringify({manifest_version: 3, name: 'x', version: '1'})
      )

      thisCompilationFn?.(compilation)
      processAssetsFn?.()

      return warnings.map((warning) => warning.name)
    }
  }

  const BOTH = ['WebAssemblyPolicyWarning', 'RemoteWebAssemblyWarning']

  it('warns once per session, even when the binary hash moves', () => {
    const compile = session('development')

    expect(compile('assets/codec.aaaa.wasm')).toEqual(BOTH)
    expect(compile('assets/codec.bbbb.wasm')).toEqual([])
  })

  it('warns on every production build', () => {
    const compile = session('production')

    expect(compile('assets/codec.aaaa.wasm')).toEqual(BOTH)
    expect(compile('assets/codec.aaaa.wasm')).toEqual(BOTH)
  })
})

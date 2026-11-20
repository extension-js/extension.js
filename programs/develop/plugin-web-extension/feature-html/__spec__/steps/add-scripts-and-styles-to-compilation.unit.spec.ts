import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it} from 'vitest'
import {EXTENSIONJS_SANDBOX_LAYER} from '../../../feature-scripts/contracts'
import {AddScriptsAndStylesToCompilation} from '../../steps/add-scripts-and-styles-to-compilation'

const tmpRoots: string[] = []

afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, {recursive: true, force: true})
})

function makeTmp(name: string) {
  const created = fs.mkdtempSync(
    path.join(os.tmpdir(), `extjs-scripts-styles-${name}-`)
  )
  tmpRoots.push(created)

  return fs.realpathSync(created)
}

describe('AddScriptsAndStylesToCompilation', () => {
  const originalEnv = {
    host: process.env.EXTENSION_DEV_SERVER_HOST,
    port: process.env.EXTENSION_DEV_SERVER_PORT,
    path: process.env.EXTENSION_DEV_SERVER_PATH,
    protocol: process.env.EXTENSION_DEV_SERVER_PROTOCOL
  }

  beforeEach(() => {
    process.env.EXTENSION_DEV_SERVER_HOST = originalEnv.host
    process.env.EXTENSION_DEV_SERVER_PORT = originalEnv.port
    process.env.EXTENSION_DEV_SERVER_PATH = originalEnv.path
    process.env.EXTENSION_DEV_SERVER_PROTOCOL = originalEnv.protocol
  })

  afterEach(() => {
    process.env.EXTENSION_DEV_SERVER_HOST = originalEnv.host
    process.env.EXTENSION_DEV_SERVER_PORT = originalEnv.port
    process.env.EXTENSION_DEV_SERVER_PATH = originalEnv.path
    process.env.EXTENSION_DEV_SERVER_PROTOCOL = originalEnv.protocol
  })

  it('creates entry per feature and includes assets when no public root exists', () => {
    const tmp = makeTmp('steps')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head><link rel="stylesheet" href="/styles.css"></head><body><script src="main.js"></script></body></html>`
    )

    fs.writeFileSync(path.join(tmp, 'main.js'), '// main')
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    const compiler: any = {options: {mode: 'production', entry: {}}}
    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'feature/index': htmlPath}
    }).apply(compiler as any)

    expect(
      compiler.options.entry['feature/index'].import.some((p: string) =>
        p.endsWith('minimum-script-file')
      )
    ).toBe(false)

    expect(
      compiler.options.entry['feature/index'].import.some((p: string) =>
        p.endsWith('main.js')
      )
    ).toBe(true)

    expect(
      compiler.options.entry['feature/index'].import.some((p: string) =>
        p.endsWith('/styles.css')
      )
    ).toBe(false)
  })

  it('puts a sandbox page entry on the sandbox layer and leaves a normal page entry off it', () => {
    const tmp = makeTmp('steps-sandbox-layer')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><body><script src="main.js"></script></body></html>`
    )

    fs.writeFileSync(path.join(tmp, 'main.js'), '// main')
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    const compiler: any = {options: {mode: 'production', entry: {}}}

    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'sandbox/page-0': htmlPath, 'action/index': htmlPath}
    }).apply(compiler as any)

    expect(EXTENSIONJS_SANDBOX_LAYER).toEqual(expect.any(String))
    expect(compiler.options.entry['sandbox/page-0'].layer).toBe(
      EXTENSIONJS_SANDBOX_LAYER
    )

    expect('layer' in compiler.options.entry['action/index']).toBe(false)
  })

  it('drops a <script src> whose file does not exist instead of failing the bundle', () => {
    const tmp = makeTmp('steps-dead-ref')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><body><script src="exists.js"></script><script src="dead-ref.js"></script></body></html>`
    )

    fs.writeFileSync(path.join(tmp, 'exists.js'), '// exists')
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    const compiler: any = {options: {mode: 'production', entry: {}}}
    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'feature/index': htmlPath}
    }).apply(compiler as any)

    const imports = compiler.options.entry['feature/index'].import as string[]
    expect(imports.some((p) => p.endsWith('exists.js'))).toBe(true)
    expect(imports.some((p) => p.endsWith('dead-ref.js'))).toBe(false)
  })

  it('injects HMR minimum script in development mode', () => {
    const tmp = makeTmp('steps-dev')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(htmlPath, `<html><head></head><body></body></html>`)
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    const compiler: any = {
      options: {
        mode: 'development',
        entry: {},
        devServer: {
          host: '127.0.0.1',
          port: 8080,
          hot: 'only',
          liveReload: true
        }
      }
    }
    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'feature/index': htmlPath}
    }).apply(compiler as any)

    const imports = compiler.options.entry['feature/index'].import as string[]
    const shimIdx = imports.findIndex((p) => p.includes('preact-refresh-shim'))
    const hmrIdx = imports.findIndex((p) =>
      p.replace(/\\/g, '/').includes('dev-server/client/index.js?')
    )
    expect(
      shimIdx,
      'preact-refresh-shim must be in entry chain'
    ).toBeGreaterThanOrEqual(0)

    expect(
      hmrIdx,
      'rspack-dev-server client must be in entry chain'
    ).toBeGreaterThanOrEqual(0)

    expect(shimIdx).toBeLessThan(hmrIdx)
    expect(imports.some((p) => p.includes('minimum-script-file'))).toBe(true)
  })

  it('keeps page HMR imports via env wiring when compiler devServer is absent', () => {
    const tmp = makeTmp('steps-dev-env')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(htmlPath, `<html><head></head><body></body></html>`)
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    process.env.EXTENSION_DEV_SERVER_HOST = '127.0.0.1'
    process.env.EXTENSION_DEV_SERVER_PORT = '9090'
    process.env.EXTENSION_DEV_SERVER_PATH = '/ws'
    process.env.EXTENSION_DEV_SERVER_PROTOCOL = 'ws'

    const compiler: any = {
      options: {
        mode: 'development',
        entry: {}
      }
    }

    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'feature/index': htmlPath}
    }).apply(compiler as any)

    const imports = compiler.options.entry['feature/index'].import as string[]
    const shimIdx = imports.findIndex((p) => p.includes('preact-refresh-shim'))
    const hmrIdx = imports.findIndex((p) =>
      p.replace(/\\/g, '/').includes('dev-server/client/index.js?')
    )
    expect(shimIdx).toBeGreaterThanOrEqual(0)
    expect(hmrIdx).toBeGreaterThanOrEqual(0)
    expect(shimIdx).toBeLessThan(hmrIdx)
    expect(
      imports.some((p) => p.replace(/\\/g, '/').includes('hot/dev-server'))
    ).toBe(true)
  })

  it('points the stock dev socket file at the class that names the page', () => {
    const tmp = makeTmp('steps-socket')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(htmlPath, `<html><head></head><body></body></html>`)
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    let provided = 0
    class ProvidePlugin {
      constructor() {
        provided += 1
      }

      apply() {}
    }
    const compiler: any = {
      rspack: {ProvidePlugin},
      options: {
        mode: 'development',
        entry: {},
        resolve: {alias: {kept: '/kept'}},
        devServer: {host: '127.0.0.1', port: 8080, hot: 'only'}
      }
    }
    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'feature/index': htmlPath}
    }).apply(compiler as any)

    // The dev server provides the socket class itself, a second provider
    // conflicts with it on every compile.
    expect(provided).toBe(0)
    const alias = compiler.options.resolve.alias as Record<string, string>
    expect(alias.kept).toBe('/kept')
    const keys = Object.keys(alias).filter((key) => key !== 'kept')
    expect(keys).toHaveLength(1)
    expect(keys[0].replace(/\\/g, '/')).toMatch(
      /@rspack\/dev-server\/client\/clients\/WebSocketClient\.js\$$/
    )

    expect(alias[keys[0]].replace(/\\/g, '/')).toMatch(
      /page-socket-client(\.m?js)?$/
    )
  })

  it('leaves the dev socket alone in a build with no dev client', () => {
    const tmp = makeTmp('steps-socket-prod')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(htmlPath, `<html><head></head><body></body></html>`)
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    const compiler: any = {
      options: {mode: 'production', entry: {}}
    }
    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'feature/index': htmlPath}
    }).apply(compiler as any)

    expect(compiler.options.resolve?.alias).toBeUndefined()
  })
})

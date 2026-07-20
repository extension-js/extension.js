import * as fs from 'fs'
import * as path from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {AddScriptsAndStylesToCompilation} from '../../steps/add-scripts-and-styles-to-compilation'

function makeTmp(name: string) {
  const tmp = path.join(__dirname, `.tmp-${name}`)
  fs.rmSync(tmp, {recursive: true, force: true})
  fs.mkdirSync(tmp, {recursive: true})
  return tmp
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
    // A root-absolute ref is an EXTENSION-ROOT reference (Chrome resolves '/'
    // from the extension root), never a module to bundle, with or without a
    // public/ dir. This used to assert the opposite: with no public/ dir the
    // ref was bundled as an entry, which is exactly how a wild extension died
    // with "Module not found: Can't resolve '/styles.css'" (BUGS_TO_FIX §18).
    // It is served from the output root instead.
    expect(
      compiler.options.entry['feature/index'].import.some((p: string) =>
        p.endsWith('/styles.css')
      )
    ).toBe(false)
  })

  it('drops a <script src> whose file does not exist instead of failing the bundle (§17)', () => {
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
    // Chrome silently 404s dead-ref.js and runs the page; feeding it to
    // rspack as an entry import fails the whole build with "Module not
    // found". The existing script must still bundle.
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
    // Refresh shim must run before the rspack-dev-server HMR client and any
    // user .tsx module that the refresh loader transformed (top-level
    // `$RefreshReg$`/`$RefreshSig$` calls). Verify the order: shim → HMR
    // client → ... → minimum-script-file.
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
})

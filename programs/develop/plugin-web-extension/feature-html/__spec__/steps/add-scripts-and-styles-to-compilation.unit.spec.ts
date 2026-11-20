import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {EXTENSIONJS_SANDBOX_LAYER} from '../../../feature-scripts/contracts'
import {AddScriptsAndStylesToCompilation} from '../../steps/add-scripts-and-styles-to-compilation'
import {trackTempFolders} from '../../../../__spec__/helpers/temp-folders'

const tempFolder = trackTempFolders()

function makeTmp(name: string) {
  const created = tempFolder(`extjs-scripts-styles-${name}-`)

  return fs.realpathSync(created)
}

describe('AddScriptsAndStylesToCompilation', () => {
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

  it('declares the same entry in development as in production, and names each page', () => {
    const tmp = makeTmp('steps-dev')
    const htmlPath = path.join(tmp, 'index.html')
    fs.writeFileSync(
      htmlPath,
      `<html><head></head><body><script src="main.js"></script></body></html>`
    )

    fs.writeFileSync(path.join(tmp, 'main.js'), '// main')
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    const missing = path.join(tmp, 'missing.html')

    const entriesOf = (mode: string) => {
      const compiler: any = {
        options: {
          mode,
          entry: {},
          devServer: {host: '127.0.0.1', port: 8080, hot: 'only'}
        }
      }
      const step = new AddScriptsAndStylesToCompilation({
        manifestPath,
        includeList: {'feature/index': htmlPath, 'feature/missing': missing}
      })

      step.apply(compiler as any)

      return {compiler, step}
    }

    const development = entriesOf('development')
    const production = entriesOf('production')

    expect(development.compiler.options.entry).toEqual({
      'feature/index': {import: [path.join(tmp, 'main.js')]}
    })

    expect(development.compiler.options.entry).toEqual(
      production.compiler.options.entry
    )

    expect(development.compiler.options.resolve).toBeUndefined()
    expect(development.step.pages).toEqual([
      {
        entry: 'feature/index',
        file: htmlPath,
        scripts: [path.join(tmp, 'main.js')]
      }
    ])
  })
})

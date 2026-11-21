import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {asCompiler} from '../../../__spec__/helpers/rspack-fakes'
import {EXTENSIONJS_SANDBOX_LAYER} from '../../../feature-scripts/contracts'
import {AddScriptsAndStylesToCompilation} from '../../steps/add-scripts-and-styles-to-compilation'

// The compiler options the entry step reads and writes.
type EntryCompiler = {
  options: {
    mode: string
    entry: Record<string, {import: string[]; layer?: string}>
    resolve?: unknown
    devServer?: {host: string; port: number; hot: string}
  }
}

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
    const compiler: EntryCompiler = {options: {mode: 'production', entry: {}}}
    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'feature/index': htmlPath}
    }).apply(asCompiler(compiler))

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
    const compiler: EntryCompiler = {options: {mode: 'production', entry: {}}}

    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'sandbox/page-0': htmlPath, 'action/index': htmlPath}
    }).apply(asCompiler(compiler))

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
    const compiler: EntryCompiler = {options: {mode: 'production', entry: {}}}
    new AddScriptsAndStylesToCompilation({
      manifestPath,
      includeList: {'feature/index': htmlPath}
    }).apply(asCompiler(compiler))

    const imports = compiler.options.entry['feature/index'].import
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
      const compiler: EntryCompiler = {
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

      step.apply(asCompiler(compiler))

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

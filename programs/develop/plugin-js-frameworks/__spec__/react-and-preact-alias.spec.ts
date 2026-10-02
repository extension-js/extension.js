import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {JsFrameworksPlugin} from '../index'
import {getJsxImportSource} from '../js-frameworks-lib/jsx-transform'

function writePackage(root: string, name: string, files: string[]) {
  const packageRoot = path.join(root, 'node_modules', ...name.split('/'))

  fs.mkdirSync(packageRoot, {recursive: true})
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({name, version: '19.0.0', main: 'index.js'})
  )

  for (const file of ['index.js', ...files]) {
    const target = path.join(packageRoot, file)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, 'module.exports = {}\n')
  }

  return packageRoot
}

function createCompiler(projectPath: string) {
  const beforeRun: any = {
    tapPromise: vi.fn((_name: string, cb: () => Promise<void>) => {
      beforeRun._cb = cb
    })
  }

  return {
    options: {
      mode: 'production',
      context: projectPath,
      plugins: [] as unknown[],
      resolve: {alias: {}, extensions: [] as string[]},
      module: {rules: [] as unknown[]}
    },
    hooks: {beforeRun, watchRun: {tapPromise: vi.fn()}}
  } as any
}

describe('a project that declares both React and Preact', () => {
  let projectPath: string

  beforeEach(() => {
    projectPath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-react-preact-'))
    )

    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({
        name: 'react-and-preact',
        dependencies: {react: '*', 'react-dom': '*', preact: '*'}
      })
    )

    fs.writeFileSync(
      path.join(projectPath, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'react-and-preact',
        version: '0.0.1'
      })
    )

    writePackage(projectPath, 'react', ['jsx-runtime.js', 'jsx-dev-runtime.js'])
    writePackage(projectPath, 'react-dom', ['client.js'])
    writePackage(projectPath, 'preact', [
      'jsx-runtime.js',
      'jsx-dev-runtime.js',
      'compat/index.js',
      'test-utils/index.js'
    ])
  })

  afterEach(() => {
    fs.rmSync(projectPath, {recursive: true, force: true})
  })

  it('compiles and renders against the same renderer', async () => {
    const compiler = createCompiler(projectPath)
    const plugin = new JsFrameworksPlugin({
      manifestPath: path.join(projectPath, 'manifest.json'),
      browser: 'chrome',
      mode: 'production'
    })

    await plugin.apply(compiler)
    await compiler.hooks.beforeRun._cb()

    const alias = compiler.options.resolve.alias as Record<string, string>
    const reactDir = path.join(projectPath, 'node_modules', 'react')
    const preactDir = path.join(projectPath, 'node_modules', 'preact')

    expect(getJsxImportSource(projectPath)).toBe('react')
    expect(alias['react/jsx-runtime']).toBe(
      path.join(reactDir, 'jsx-runtime.js')
    )

    expect(alias['react/jsx-dev-runtime']).toBe(
      path.join(reactDir, 'jsx-dev-runtime.js')
    )

    expect(alias.react$).toBe(path.join(reactDir, 'index.js'))
    expect(alias['react-dom/client']).toBe(
      path.join(projectPath, 'node_modules', 'react-dom', 'client.js')
    )

    expect(alias.react).toBeUndefined()
    expect(alias['react-dom']).toBeUndefined()
    expect(alias['react-dom/test-utils']).toBeUndefined()

    expect(alias.preact).toBe(preactDir)
    expect(alias['preact/jsx-runtime']).toBe(
      path.join(preactDir, 'jsx-runtime.js')
    )
  })
})

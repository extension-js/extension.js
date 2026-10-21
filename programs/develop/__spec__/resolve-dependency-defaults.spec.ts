import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../lib/project'
import webpackConfig from '../rspack-config'

const roots: string[] = []

function scaffold(name: string) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `extjs-resolve-${name}-`))
  )
  roots.push(root)

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: `extjs-resolve-${name}`,
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'resolve',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      action: {default_popup: 'popup.html'}
    }),
    'node_modules/style-only/package.json': JSON.stringify({
      name: 'style-only',
      version: '1.0.0',
      exports: {'.': {style: './dist/style-only.css'}}
    }),
    'node_modules/style-only/dist/style-only.css':
      '.style-only-marker { color: red; }\n',
    'node_modules/mode-branch/package.json': JSON.stringify({
      name: 'mode-branch',
      version: '1.0.0',
      exports: {
        '.': {
          development: './dev.js',
          production: './prod.js',
          default: './default.js'
        }
      }
    }),
    'node_modules/mode-branch/dev.js': "export const build = 'dev-branch'\n",
    'node_modules/mode-branch/prod.js': "export const build = 'prod-branch'\n",
    'node_modules/mode-branch/default.js':
      "export const build = 'default-branch'\n",
    'theme.css': '.theme-marker { color: blue; }\n',
    'style.css': '@import "style-only";\n@import "./theme";\n',
    'popup.html':
      '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><script src="./popup.js"></script></body></html>',
    'popup.js': 'globalThis.__popup = 1\n',
    'background.js': [
      "import {build} from 'mode-branch'",
      'globalThis.__build = build',
      ''
    ].join('\n')
  }

  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }

  return root
}

function readTree(dir: string, extension: string): string {
  let out = ''

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) out += readTree(full, extension)
    else if (entry.name.endsWith(extension)) {
      out += fs.readFileSync(full, 'utf-8')
    }
  }

  return out
}

async function compile(root: string, mode: 'development' | 'production') {
  const distPath = path.join(root, 'dist', 'chrome')
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode,
    metadataCommand: mode === 'production' ? 'build' : 'dev',
    silent: true,
    output: {clean: true, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright' &&
      plugin?.constructor.name !== 'plugin-reload'
  )

  config.stats = false

  const compiler = rspack(config)
  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('no stats'))

      resolve(result)
    })
  })

  return {
    byDependency: compiler.options.resolve.byDependency || {},
    errors: (stats.toJson({errors: true}).errors || []).map(
      (error) => error.message || String(error)
    ),
    css: readTree(distPath, '.css'),
    js: readTree(distPath, '.js')
  }
}

afterAll(() => {
  for (const root of roots) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('resolve keeps every per-dependency-type default', () => {
  it('lists the same dependency types as stock rspack', async () => {
    const stock = rspack({mode: 'production', entry: {}, context: os.tmpdir()})
    const root = scaffold('types')
    const {byDependency} = await compile(root, 'production')

    expect(Object.keys(byDependency).sort()).toEqual(
      Object.keys(stock.options.resolve.byDependency || {}).sort()
    )

    expect(byDependency.commonjs?.conditionNames).toContain('require')
    expect(byDependency.commonjs?.conditionNames).not.toContain('import')
    expect(byDependency.esm?.conditionNames).toContain('import')
    expect(byDependency.esm?.conditionNames).not.toContain('require')
  })

  for (const mode of ['production', 'development'] as const) {
    it(`${mode}: css @import resolves the style condition and a bare .css name`, async () => {
      const root = scaffold(`css-${mode}`)
      const {errors, css} = await compile(root, mode)

      expect(errors).toEqual([])
      expect(css).toContain('.style-only-marker')
      expect(css).toContain('.theme-marker')
    })
  }

  it('development picks the development export and production the production one', async () => {
    const dev = await compile(scaffold('mode-dev'), 'development')
    const prod = await compile(scaffold('mode-prod'), 'production')

    expect(dev.errors).toEqual([])
    expect(prod.errors).toEqual([])
    expect(dev.js).toContain('dev-branch')
    expect(dev.js).not.toContain('default-branch')
    expect(prod.js).toContain('prod-branch')
    expect(prod.js).not.toContain('default-branch')
  })
})

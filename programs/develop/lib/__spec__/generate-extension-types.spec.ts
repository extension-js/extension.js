import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {renderExtensionEnvTypes} from '../extension-env-template'
import {generateExtensionTypes} from '../generate-extension-types'

const require = createRequire(__filename)

const publishedTypesDir = path.resolve(__dirname, '../../../extension/types')
const publishedTypesFile = path.join(publishedTypesDir, 'assets.d.ts')

const bundlerImportShapes = [
  'theme.css',
  'theme.scss',
  'theme.sass',
  'legacy.less',
  'card.module.css',
  'card.module.scss',
  'card.module.sass',
  'card.module.less',
  'icon.png',
  'icon.jpg',
  'icon.jpeg',
  'icon.gif',
  'icon.webp',
  'icon.avif',
  'icon.ico',
  'icon.bmp',
  'icon.svg',
  'doc.txt?raw',
  'plain.css?raw',
  'icon.png?url'
]

function wildcardPatternsIn(source: string) {
  return [...source.matchAll(/^declare module '(\*[^']+)'/gm)].map(
    (match) => match[1]
  )
}

function packageDir(specifier: string) {
  return path.dirname(require.resolve(`${specifier}/package.json`))
}

function linkDir(target: string, link: string) {
  fs.mkdirSync(path.dirname(link), {recursive: true})
  fs.symlinkSync(target, link, 'junction')
}

function writeTypescriptProject(root: string) {
  const srcDir = path.join(root, 'src')
  fs.mkdirSync(srcDir, {recursive: true})

  for (const shape of bundlerImportShapes) {
    fs.writeFileSync(path.join(srcDir, shape.replace(/\?.*$/, '')), '')
  }

  const imports = bundlerImportShapes.map(
    (shape, index) => `import asset${index} from './${shape}'`
  )
  const uses = bundlerImportShapes.map((_, index) => `asset${index}`)
  fs.writeFileSync(
    path.join(srcDir, 'index.ts'),
    `${imports.join('\n')}\nimport './theme.scss'\nimport './legacy.less'\nexport const assets = [${uses.join(', ')}]\n`
  )

  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'esnext',
        target: 'esnext',
        moduleResolution: 'bundler',
        lib: ['dom', 'esnext'],
        noEmit: true
      },
      include: ['src', 'extension-env.d.ts']
    })
  )

  const extensionDir = path.join(root, 'node_modules', 'extension')
  fs.mkdirSync(extensionDir, {recursive: true})
  fs.cpSync(publishedTypesDir, path.join(extensionDir, 'types'), {
    recursive: true
  })

  fs.writeFileSync(
    path.join(extensionDir, 'package.json'),
    JSON.stringify({
      name: 'extension',
      version: '0.0.0',
      exports: {
        './types': {types: './types/index.d.ts'},
        './types/polyfill': {types: './types/polyfill.d.ts'}
      }
    })
  )

  for (const types of ['node', 'chrome', 'webextension-polyfill']) {
    linkDir(
      packageDir(`@types/${types}`),
      path.join(root, 'node_modules', '@types', types)
    )
  }
}

function runTsc(root: string) {
  return spawnSync(
    process.execPath,
    [path.join(packageDir('typescript'), 'bin', 'tsc'), '-p', root],
    {cwd: root, encoding: 'utf8'}
  )
}

const created: string[] = []

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)

  return dir
}

afterEach(() => {
  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }

  created.length = 0
})

describe('generate-extension-types', () => {
  it('writes extension-env.d.ts in package json dir', async () => {
    const root = makeTempDir('extjs-gen-types-')
    const pkgDir = root
    const manifestDir = root
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    await generateExtensionTypes(manifestDir, pkgDir)
    const target = path.join(pkgDir, 'extension-env.d.ts')
    expect(fs.existsSync(target)).toBe(true)
    const content = fs.readFileSync(target, 'utf8')
    expect(content).toContain('reference types="extension/types"')
    expect(content).toContain('reference types="extension/types/polyfill"')
  })

  it('leaves the asset and stylesheet declares to the shipped types', async () => {
    const root = makeTempDir('extjs-gen-wildcards-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    await generateExtensionTypes(root, root)
    const content = fs.readFileSync(
      path.join(root, 'extension-env.d.ts'),
      'utf8'
    )

    expect(content).toContain('/// <reference types="extension/types" />')
    expect(content).toBe(renderExtensionEnvTypes())
    expect(content).not.toMatch(/^(import|export) /m)
    expect(wildcardPatternsIn(content)).toEqual([])
  })

  it('declares the define constants with the types their values resolve to', async () => {
    const root = makeTempDir('extjs-gen-define-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    fs.writeFileSync(
      path.join(root, 'extension.config.js'),
      [
        'module.exports = {',
        "  define: {API_URL: 'https://a.example', RETRIES: 3, FLAGS: {a: true}, 'process.env.MODE': 'x'},",
        "  browser: {firefox: {define: {RETRIES: 'many', FIREFOX_ONLY: true}}},",
        '  commands: {dev: {define: {DEV_PORT: 1234}}}',
        '}',
        ''
      ].join('\n')
    )

    await generateExtensionTypes(root, root)
    const content = fs.readFileSync(
      path.join(root, 'extension-env.d.ts'),
      'utf8'
    )

    expect(content).toContain('declare const API_URL: string\n')
    expect(content).toContain('declare const RETRIES: number | string\n')
    expect(content).toContain('declare const FLAGS: Record<string, unknown>\n')
    expect(content).toContain('declare const FIREFOX_ONLY: boolean\n')
    expect(content).toContain('declare const DEV_PORT: number\n')
    expect(content).not.toContain('process.env.MODE')
  })

  it('declares each wildcard the bundler accepts once, in extension/types/assets.d.ts', () => {
    const published = fs.readFileSync(publishedTypesFile, 'utf8')
    const publishedPatterns = wildcardPatternsIn(published)

    expect(publishedPatterns).toEqual([
      '*.css',
      '*.scss',
      '*.sass',
      '*.less',
      '*.module.css',
      '*.module.scss',
      '*.module.sass',
      '*.module.less',
      '*.png',
      '*.jpg',
      '*.jpeg',
      '*.gif',
      '*.webp',
      '*.avif',
      '*.ico',
      '*.bmp',
      '*.svg',
      '*?raw',
      '*?url'
    ])

    expect(new Set(publishedPatterns).size).toBe(publishedPatterns.length)
    expect(wildcardPatternsIn(renderExtensionEnvTypes())).toEqual([])
  })

  it('typechecks every bundler import shape with no skipLibCheck', async () => {
    const root = makeTempDir('extjs-gen-tsc-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    writeTypescriptProject(root)

    await generateExtensionTypes(root, root)
    const result = runTsc(root)

    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it.skip('writes extension-paths.d.ts with unions', async () => {
    const root = makeTempDir('extjs-gen-paths-')
    const pkgDir = root
    const manifestDir = root
    fs.writeFileSync(
      path.join(manifestDir, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    fs.mkdirSync(path.join(root, 'public'), {recursive: true})
    fs.writeFileSync(path.join(root, 'public', 'logo.png'), '')
    fs.mkdirSync(path.join(root, 'pages'), {recursive: true})
    fs.writeFileSync(path.join(root, 'pages', 'home.html'), '')
    fs.mkdirSync(path.join(root, 'scripts'), {recursive: true})
    fs.writeFileSync(path.join(root, 'scripts', 'a.ts'), '')
    await generateExtensionTypes(manifestDir, pkgDir)
    const target = path.join(pkgDir, 'extension-paths.d.ts')
    expect(fs.existsSync(target)).toBe(true)
    const content = fs.readFileSync(target, 'utf8')
    expect(content).toContain("'public/logo.png'")
    expect(content).toContain("'/public/logo.png'")
    expect(content).toContain("'/logo.png'")
    expect(content).toContain("'pages/home.html'")
    expect(content).toContain("'scripts/a.ts'")
  })
})

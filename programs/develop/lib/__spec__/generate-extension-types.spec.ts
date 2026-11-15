import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {takeCodedWarnings} from '../coded-warnings'
import {
  EXTENSION_ENV_WILDCARD_MODULES,
  projectBringsOwnChromeTypes,
  renderExtensionEnvTypes
} from '../extension-env-template'
import {
  generateExtensionTypes,
  resolvesExtensionPackage
} from '../generate-extension-types'

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

// Each wildcard block with its default export type, local aliases resolved,
// so the inline list and the shipped file compare as the compiler sees them.
function wildcardDeclarationsIn(rawSource: string) {
  const source = rawSource.replace(/\r\n/g, '\n')
  const aliases = new Map(
    [...source.matchAll(/^type (\w+) = (.+)$/gm)].map((match) => [
      match[1],
      match[2]
    ])
  )

  return [
    ...source.matchAll(
      /^declare module '(\*[^']+)' \{\n(?: {2}\/\/[^\n]*\n)* {2}const content: ([^\n]+)\n {2}export default content\n\}/gm
    )
  ].map((match) => ({
    pattern: match[1],
    type: aliases.get(match[2]) ?? match[2]
  }))
}

function packageDir(specifier: string) {
  return path.dirname(require.resolve(`${specifier}/package.json`))
}

function linkDir(target: string, link: string) {
  fs.mkdirSync(path.dirname(link), {recursive: true})
  fs.symlinkSync(target, link, 'junction')
}

// Calls that only one of the two packages used to type: the Firefox sidebar
// and Manifest V2 button, next to APIs every target has.
const extensionApiSource = `\
export async function openSidebar() {
  await browser.sidebarAction.open()
  const title: string = await browser.sidebarAction.getTitle({})
  return title
}

browser.browserAction.onClicked.addListener(() => {})

export const pageUrl: string = chrome.runtime.getURL('page.html')
export const tabs = browser.tabs.query({active: true})
`

function writeTypescriptProject(
  root: string,
  {withExtensionPackage = true, ownChromeTypes = false} = {}
) {
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

  if (withExtensionPackage) {
    writeExtensionPackage(root)
    fs.writeFileSync(path.join(srcDir, 'apis.ts'), extensionApiSource)
  }

  for (const types of ['node', 'webextension-polyfill']) {
    linkDir(
      packageDir(`@types/${types}`),
      path.join(root, 'node_modules', '@types', types)
    )
  }

  if (ownChromeTypes) {
    linkDir(
      packageDir('@types/chrome'),
      path.join(root, 'node_modules', '@types', 'chrome')
    )
  } else {
    linkDir(
      packageDir('chrome-types'),
      path.join(root, 'node_modules', 'chrome-types')
    )
  }
}

function writeExtensionPackage(root: string) {
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
        './types/legacy': {types: './types/legacy.d.ts'},
        './types/polyfill': {types: './types/polyfill.d.ts'}
      }
    })
  )
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

  it('leaves an up to date extension-env.d.ts alone and says when it changes one', async () => {
    const root = makeTempDir('extjs-gen-rewrite-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    const target = path.join(root, 'extension-env.d.ts')
    const printed: string[] = []
    const logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(' '))
      })

    try {
      await generateExtensionTypes(root, root)
      expect(printed.filter((line) => line.includes('Writing'))).toHaveLength(1)

      const written = fs.statSync(target).mtimeMs
      await new Promise((resolve) => setTimeout(resolve, 20))
      printed.length = 0
      await generateExtensionTypes(root, root)
      expect(fs.statSync(target).mtimeMs).toBe(written)
      expect(printed).toEqual([])

      fs.writeFileSync(target, '// stale\n')
      printed.length = 0
      await generateExtensionTypes(root, root)
      expect(fs.readFileSync(target, 'utf8')).not.toContain('stale')
      expect(printed).toHaveLength(1)
      expect(printed[0]).toContain('Updating the type definitions')
      expect(printed[0]).toContain(target)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('leaves the asset and stylesheet declares to the shipped types when extension is installed', async () => {
    const root = makeTempDir('extjs-gen-wildcards-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    writeExtensionPackage(root)
    expect(resolvesExtensionPackage(root)).toBe(true)

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

  // Every example runs the CLI through npx and declares no extension of its
  // own, so the reference above resolves to nothing and the declares go inline.
  it('writes the asset and stylesheet declares when extension does not resolve', async () => {
    const root = makeTempDir('extjs-gen-npx-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    expect(resolvesExtensionPackage(root)).toBe(false)

    await generateExtensionTypes(root, root)
    const content = fs.readFileSync(
      path.join(root, 'extension-env.d.ts'),
      'utf8'
    )

    expect(content).toBe(
      renderExtensionEnvTypes(undefined, {}, {inlineAssetTypes: true})
    )

    expect(content).toContain('/// <reference types="extension/types" />')
    expect(content).not.toMatch(/^(import|export) /m)
    expect(wildcardPatternsIn(content)).toEqual(
      wildcardPatternsIn(fs.readFileSync(publishedTypesFile, 'utf8'))
    )
  })

  it('finds a hoisted extension package the way the types reference does', () => {
    const root = makeTempDir('extjs-gen-hoisted-')
    const nested = path.join(root, 'packages', 'my-extension')
    fs.mkdirSync(nested, {recursive: true})
    expect(resolvesExtensionPackage(nested)).toBe(false)

    writeExtensionPackage(root)
    expect(resolvesExtensionPackage(nested)).toBe(true)
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

  it('keeps the inline wildcard list in step with extension/types/assets.d.ts', () => {
    const published = wildcardDeclarationsIn(
      fs.readFileSync(publishedTypesFile, 'utf8')
    )

    expect(published.length).toBeGreaterThan(0)
    expect([...EXTENSION_ENV_WILDCARD_MODULES]).toEqual(published)
    expect(
      wildcardDeclarationsIn(
        renderExtensionEnvTypes(undefined, {}, {inlineAssetTypes: true})
      )
    ).toEqual(published)
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

  it('types browser from chrome-types and the Firefox declaration by default', async () => {
    const root = makeTempDir('extjs-gen-tsc-default-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    writeTypescriptProject(root)
    expect(projectBringsOwnChromeTypes(root)).toBe(false)

    await generateExtensionTypes(root, root)
    const content = fs.readFileSync(
      path.join(root, 'extension-env.d.ts'),
      'utf8'
    )

    expect(content).toContain('/// <reference types="extension/types" />')
    expect(content).not.toContain('extension/types/legacy')
    expect(content).not.toContain('<reference types="chrome" />')

    const listed = spawnSync(
      process.execPath,
      [
        path.join(packageDir('typescript'), 'bin', 'tsc'),
        '-p',
        root,
        '--listFiles'
      ],
      {cwd: root, encoding: 'utf8'}
    )
    const files = listed.stdout.split('\n').map((file) => file.trim())

    expect(listed.status).toBe(0)
    expect(
      files.some((file) => /chrome-types[\\/]index\.d\.ts$/.test(file))
    ).toBe(true)

    expect(files.some((file) => /types[\\/]firefox\.d\.ts$/.test(file))).toBe(
      true
    )

    expect(files.some((file) => /@types[\\/]chrome[\\/]/.test(file))).toBe(
      false
    )
  })

  // Both packages declare the chrome global, so a project with its own
  // @types/chrome keeps it and chrome-types never loads beside it.
  it('keeps @types/chrome and the polyfill browser for a project that installs it', async () => {
    const root = makeTempDir('extjs-gen-tsc-own-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    writeTypescriptProject(root, {ownChromeTypes: true})
    expect(projectBringsOwnChromeTypes(root)).toBe(true)

    await generateExtensionTypes(root, root)
    const content = fs.readFileSync(
      path.join(root, 'extension-env.d.ts'),
      'utf8'
    )

    expect(content).toBe(
      renderExtensionEnvTypes(undefined, {}, {ownChromeTypes: true})
    )

    expect(content).toContain(
      '/// <reference types="extension/types/legacy" />'
    )

    expect(content).toContain('/// <reference types="chrome" />')
    expect(content).not.toContain('/// <reference types="extension/types" />')

    const listed = spawnSync(
      process.execPath,
      [
        path.join(packageDir('typescript'), 'bin', 'tsc'),
        '-p',
        root,
        '--listFiles'
      ],
      {cwd: root, encoding: 'utf8'}
    )
    const files = listed.stdout.split('\n').map((file) => file.trim())

    expect(listed.stdout + listed.stderr).not.toContain('error TS')
    expect(listed.status).toBe(0)
    expect(files.some((file) => /@types[\\/]chrome[\\/]/.test(file))).toBe(true)
    expect(files.some((file) => /chrome-types[\\/]/.test(file))).toBe(false)
    expect(files.some((file) => /types[\\/]firefox\.d\.ts$/.test(file))).toBe(
      false
    )
  })

  it('reads a listed or a hoisted @types/chrome as the project bringing its own', () => {
    const root = makeTempDir('extjs-gen-own-chrome-')
    const nested = path.join(root, 'packages', 'my-extension')
    fs.mkdirSync(nested, {recursive: true})
    expect(projectBringsOwnChromeTypes(nested)).toBe(false)

    // Listed and not installed yet, as at create time.
    fs.writeFileSync(
      path.join(nested, 'package.json'),
      JSON.stringify({devDependencies: {'@types/chrome': '^0.0.287'}})
    )

    expect(projectBringsOwnChromeTypes(nested)).toBe(true)

    fs.writeFileSync(path.join(nested, 'package.json'), '{}')
    expect(projectBringsOwnChromeTypes(nested)).toBe(false)

    // Installed above the project, where TypeScript finds it on its own.
    fs.mkdirSync(path.join(root, 'node_modules', '@types', 'chrome'), {
      recursive: true
    })

    expect(projectBringsOwnChromeTypes(nested)).toBe(true)
  })

  it('types every bundler import shape with no extension installed', async () => {
    const root = makeTempDir('extjs-gen-tsc-npx-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    writeTypescriptProject(root, {withExtensionPackage: false})

    await generateExtensionTypes(root, root)
    const result = runTsc(root)
    const diagnostics = (result.stdout + result.stderr)
      .split('\n')
      .filter(Boolean)
      .map((line) =>
        line.replace(/^.*extension-env\.d\.ts/, 'extension-env.d.ts')
      )

    // Only the two references find nothing, as on every release before:
    // not one import fails to resolve, and no declare is duplicated.
    expect(diagnostics).toEqual([
      "extension-env.d.ts(6,23): error TS2688: Cannot find type definition file for 'extension/types'.",
      "extension-env.d.ts(9,23): error TS2688: Cannot find type definition file for 'extension/types/polyfill'."
    ])
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

  it('records the coded line when extension-env.d.ts cannot be written', async () => {
    const root = makeTempDir('extjs-gen-unwritable-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    const target = path.join(root, 'extension-env.d.ts')
    fs.mkdirSync(target)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    takeCodedWarnings()

    try {
      await generateExtensionTypes(root, root)
    } finally {
      logSpy.mockRestore()
    }

    const coded = takeCodedWarnings()
    expect(coded).toHaveLength(1)
    expect(coded[0]).toContain(`E_TYPES_EMIT: Writing ${target} failed: `)
    expect(coded[0]).toContain('EISDIR')
  })

  function typeScriptProject(tsconfig: string) {
    const root = makeTempDir('extjs-gen-tsconfig-')
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}')
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(
      path.join(root, 'src', 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    fs.writeFileSync(path.join(root, 'tsconfig.json'), tsconfig)

    return root
  }

  it('does not create the file where the tsconfig cannot include it', async () => {
    // Comments and a trailing comma: a tsconfig is read the way tsc reads it.
    const root = typeScriptProject(
      '{\n  // sources only\n  "include": ["src", "tests"],\n}\n'
    )
    const target = path.join(root, 'extension-env.d.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await generateExtensionTypes(path.join(root, 'src'), root)
      expect(fs.existsSync(target)).toBe(false)
      expect(logSpy).not.toHaveBeenCalled()

      // A copy the project keeps anyway is still brought up to date.
      fs.writeFileSync(target, '// stale\n')
      await generateExtensionTypes(path.join(root, 'src'), root)
      expect(fs.readFileSync(target, 'utf8')).not.toContain('stale')
    } finally {
      logSpy.mockRestore()
    }
  })

  it('creates the file where the tsconfig includes the project root', async () => {
    for (const tsconfig of [
      '{"compilerOptions": {"strict": true}}',
      '{"include": ["./", "extension-env.d.ts"]}',
      '{"include": ["**/*.ts", "**/*.tsx"]}',
      '{"files": ["extension-env.d.ts"], "include": ["src"]}'
    ]) {
      const root = typeScriptProject(tsconfig)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await generateExtensionTypes(path.join(root, 'src'), root)
      } finally {
        logSpy.mockRestore()
      }

      expect(
        fs.existsSync(path.join(root, 'extension-env.d.ts')),
        tsconfig
      ).toBe(true)
    }
  })

  it('leaves a copy alone that only a formatter changed', async () => {
    const root = makeTempDir('extjs-gen-formatted-')
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({name: 'x'})
    )

    const target = path.join(root, 'extension-env.d.ts')
    const printed: string[] = []
    const logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(' '))
      })

    try {
      await generateExtensionTypes(root, root)

      const formatted = fs
        .readFileSync(target, 'utf8')
        .replace(/'/g, '"')
        .replace(/^( {2}(?:const|export) .*)$/gm, '$1;')
        .replace(/^ {2}/gm, '\t')
      expect(formatted).toContain('export default content;')
      fs.writeFileSync(target, formatted)
      printed.length = 0

      await generateExtensionTypes(root, root)
      expect(fs.readFileSync(target, 'utf8')).toBe(formatted)
      expect(printed).toEqual([])
    } finally {
      logSpy.mockRestore()
    }
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
}))

vi.mock('../../../lib/optional-deps-resolver', () => ({
  ensureOptionalContractPackageResolved: vi.fn(
    async (input: {dependencyId: string}) =>
      `/mock/node_modules/${input.dependencyId}/index.js`
  )
}))

// The real solid-js layout: one package, two builds of the hyperscript entry
// behind the exports map. Only the import condition shares the ES module
// solid-js instance the user's own code gets.
function writeSolidPackage(projectPath: string, exportsForH: unknown) {
  const packageRoot = path.join(projectPath, 'node_modules', 'solid-js')
  const hDist = path.join(packageRoot, 'h', 'dist')
  fs.mkdirSync(hDist, {recursive: true})

  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: 'solid-js',
      version: '1.9.15',
      main: './dist/server.cjs',
      exports: {
        '.': {import: './dist/solid.js', require: './dist/solid.cjs'},
        './h': exportsForH,
        './h/dist/*': './h/dist/*',
        './package.json': './package.json'
      }
    })
  )

  fs.writeFileSync(
    path.join(hDist, 'h.js'),
    "import {createComponent} from 'solid-js'\nexport default createComponent\n"
  )

  fs.writeFileSync(
    path.join(hDist, 'h.cjs'),
    "'use strict';\nconst solid = require('solid-js');\nmodule.exports = solid.createComponent;\n"
  )

  return {packageRoot, hDist}
}

describe('solid tools', () => {
  let projectPath: string

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    // clearAllMocks keeps the implementation a previous case installed, so
    // the detection default has to be put back by hand.
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(() => false)

    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-solid-'))
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({name: 'solid-fixture', dependencies: {'solid-js': '*'}})
    )
  })

  afterEach(() => {
    fs.rmSync(projectPath, {recursive: true, force: true})
  })

  async function loadSolidTools() {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'solid-js'
    )

    return await import('../../js-tools/solid')
  }

  it('aliases solid-js/h to the single ES module instance, never the CommonJS build', async () => {
    const {hDist} = writeSolidPackage(projectPath, {
      types: './h/types/index.d.ts',
      import: './h/dist/h.js',
      require: './h/dist/h.cjs'
    })

    const {maybeUseSolid} = await loadSolidTools()
    const result = await maybeUseSolid(projectPath)
    const hyperscript = result?.alias?.['solid-js/h$'] as string

    expect(fs.realpathSync(hyperscript)).toBe(
      fs.realpathSync(path.join(hDist, 'h.js'))
    )

    expect(hyperscript.endsWith('.cjs')).toBe(false)

    // A path check alone would pass on a renamed CommonJS file. The aliased
    // file must itself be the ES module that shares the user's solid-js.
    const source = fs.readFileSync(hyperscript, 'utf-8')
    expect(source).toMatch(/\bimport\b.*'solid-js'/)
    expect(source).not.toMatch(/\brequire\(/)
  })

  it('keeps the string form of the exports entry', async () => {
    const {hDist} = writeSolidPackage(projectPath, './h/dist/h.js')

    const {maybeUseSolid} = await loadSolidTools()
    const result = await maybeUseSolid(projectPath)

    expect(fs.realpathSync(result?.alias?.['solid-js/h$'] as string)).toBe(
      fs.realpathSync(path.join(hDist, 'h.js'))
    )
  })

  it('reads through a nested browser condition', async () => {
    const {hDist} = writeSolidPackage(projectPath, {
      browser: {import: './h/dist/h.js', require: './h/dist/h.cjs'},
      require: './h/dist/h.cjs'
    })

    const {maybeUseSolid} = await loadSolidTools()
    const result = await maybeUseSolid(projectPath)

    expect(fs.realpathSync(result?.alias?.['solid-js/h$'] as string)).toBe(
      fs.realpathSync(path.join(hDist, 'h.js'))
    )
  })

  it('routes the automatic JSX runtime through the adapter', async () => {
    writeSolidPackage(projectPath, {
      import: './h/dist/h.js',
      require: './h/dist/h.cjs'
    })

    const {maybeUseSolid} = await loadSolidTools()
    const result = await maybeUseSolid(projectPath)

    expect(result?.alias?.['solid-js/jsx-runtime$']).toContain(
      'solid-jsx-runtime'
    )

    expect(result?.alias?.['solid-js/jsx-dev-runtime$']).toBe(
      result?.alias?.['solid-js/jsx-runtime$']
    )
  })

  it('compiles every script extension through Babel with the Solid preset, TypeScript stripped first', async () => {
    writeSolidPackage(projectPath, {
      import: './h/dist/h.js',
      require: './h/dist/h.cjs'
    })

    const {maybeUseSolid} = await loadSolidTools()
    const result = await maybeUseSolid(projectPath, 'production')
    const loaders = (result?.loaders || []) as any[]

    expect(loaders).toHaveLength(2)

    for (const rule of loaders) {
      expect(rule.loader).toBe('/mock/node_modules/babel-loader/index.js')
      expect(rule.exclude(path.join(projectPath, 'src', 'App.tsx'))).toBe(false)
      expect(
        rule.exclude(
          path.join(projectPath, 'node_modules', 'other-lib', 'index.jsx')
        )
      ).toBe(true)

      expect(rule.options.babelrc).toBe(false)
      expect(rule.options.configFile).toBe(false)
    }

    const jsx = loaders.find((rule) => rule.test.test('a.jsx'))
    const tsx = loaders.find((rule) => rule.test.test('a.tsx'))

    expect(jsx.options.presets).toEqual([
      ['/mock/node_modules/babel-preset-solid/index.js', {development: false}]
    ])

    expect(tsx.options.presets).toEqual([
      ['/mock/node_modules/babel-preset-solid/index.js', {development: false}],
      [
        '/mock/node_modules/@babel/preset-typescript/index.js',
        {isTSX: true, allExtensions: true, onlyRemoveTypeImports: true}
      ]
    ])

    for (const file of ['a.js', 'a.mjs', 'a.cjs', 'a.mjsx']) {
      expect(jsx.test.test(file)).toBe(true)
      expect(tsx.test.test(file)).toBe(false)
    }

    for (const file of ['a.ts', 'a.mts', 'a.cts', 'a.mtsx']) {
      expect(tsx.test.test(file)).toBe(true)
      expect(jsx.test.test(file)).toBe(false)
    }

    expect(jsx.test.test('a.json')).toBe(false)
    expect(tsx.test.test('a.json')).toBe(false)
  })

  it('asks the solid contract for every Babel piece and turns development on in dev', async () => {
    writeSolidPackage(projectPath, './h/dist/h.js')

    const resolver = (await import(
      '../../../lib/optional-deps-resolver'
    )) as any
    const {maybeUseSolid} = await loadSolidTools()
    const result = await maybeUseSolid(projectPath)

    const asked = resolver.ensureOptionalContractPackageResolved.mock.calls.map(
      (call: any[]) => [call[0].contractId, call[0].dependencyId]
    )
    expect(asked).toEqual([
      ['solid', 'babel-loader'],
      ['solid', 'babel-preset-solid'],
      ['solid', '@babel/preset-typescript']
    ])

    const presets = (result?.loaders as any[])[0].options.presets
    expect(presets[0][1]).toEqual({development: true})
  })

  it('never warns that Solid is unsupported', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const {isUsingSolid} = await loadSolidTools()

      expect(isUsingSolid(projectPath)).toBe(true)
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('stays quiet when solid-js is not a dependency', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const {isUsingSolid} = await import('../../js-tools/solid')

      expect(isUsingSolid(projectPath)).toBe(false)
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('returns undefined when solid-js is not a dependency', async () => {
    const {maybeUseSolid} = await import('../../js-tools/solid')

    expect(await maybeUseSolid(projectPath)).toBeUndefined()
  })

  it('sends a transpiled package JSX through the Solid preset', async () => {
    writeSolidPackage(projectPath, './h/dist/h.js')

    const transpiled = path.join(projectPath, 'node_modules', 'acme-ui')
    const {maybeUseSolid} = await loadSolidTools()
    const result = await maybeUseSolid(projectPath, 'development', [transpiled])

    for (const rule of (result?.loaders || []) as any[]) {
      expect(rule.exclude(path.join(transpiled, 'Button.jsx'))).toBe(false)
      expect(
        rule.exclude(
          path.join(projectPath, 'node_modules', 'other-lib', 'Button.jsx')
        )
      ).toBe(true)
    }
  })
})

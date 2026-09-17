import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
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

  it('says once per process that Solid is not supported and why', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const {isUsingSolid} = await loadSolidTools()

      expect(isUsingSolid(projectPath)).toBe(true)
      expect(isUsingSolid(projectPath)).toBe(true)
      expect(warnSpy).toHaveBeenCalledTimes(1)

      const text = String(warnSpy.mock.calls[0][0])
      expect(text).toContain('Solid is not a supported framework')
      expect(text).toContain('JSX runtime only')
      expect(text).toContain('{count()}')
      expect(text).toContain('does not update')
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
})

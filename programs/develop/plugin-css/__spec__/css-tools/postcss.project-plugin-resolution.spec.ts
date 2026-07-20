import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// Regression coverage for project-first PostCSS plugin resolution: string
// plugins from the user's config must resolve from the PROJECT's
// node_modules (postcss-loader resolves them relative to itself, which
// breaks whenever the CLI is installed outside the project, npx, global,
// isolated prefix). Unresolvable plugins warn and are skipped instead of
// failing the build.
describe('project-first postcss plugin resolution', () => {
  let tmp: string

  function writeFakePlugin(projectDir: string, name: string) {
    const pluginDir = path.join(projectDir, 'node_modules', name)
    fs.mkdirSync(pluginDir, {recursive: true})
    fs.writeFileSync(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({name, version: '1.0.0', main: 'index.js'})
    )
    fs.writeFileSync(
      path.join(pluginDir, 'index.js'),
      `module.exports = (opts) => ({postcssPlugin: '${name}', opts: opts})`
    )
  }

  beforeEach(() => {
    vi.resetModules()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-postcss-resolution-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
    vi.restoreAllMocks()
  })

  it('resolves string plugins from the project and skips unresolvable ones with a warning', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({}))
    fs.writeFileSync(
      path.join(tmp, '.postcssrc'),
      JSON.stringify({
        plugins: {
          'fake-postcss-plugin': {marker: 1},
          'totally-missing-plugin': {}
        }
      })
    )
    writeFakePlugin(tmp, 'fake-postcss-plugin')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss(tmp, {mode: 'production'} as any)

    const opts = rule.options?.postcssOptions
    expect(opts?.config).toBe(false)
    expect(Array.isArray(opts?.plugins)).toBe(true)
    expect(opts?.plugins).toHaveLength(1)
    expect(opts?.plugins[0]).toMatchObject({
      postcssPlugin: 'fake-postcss-plugin',
      opts: {marker: 1}
    })

    const warned = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(warned).toContain('totally-missing-plugin')
    expect(warned).not.toContain('fake-postcss-plugin')
  })

  it('self-loads an ESM postcss.config.mjs and resolves its plugins from the project', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({}))
    fs.writeFileSync(
      path.join(tmp, 'postcss.config.mjs'),
      `export default {plugins: {'fake-postcss-plugin': {}}}`
    )
    writeFakePlugin(tmp, 'fake-postcss-plugin')

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss(tmp, {mode: 'production'} as any)

    const opts = rule.options?.postcssOptions
    expect(opts?.config).toBe(false)
    expect(opts?.plugins).toHaveLength(1)
    expect(opts?.plugins[0]).toMatchObject({
      postcssPlugin: 'fake-postcss-plugin'
    })
  })

  it('disables plugins configured as false and keeps entry order', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({}))
    fs.writeFileSync(
      path.join(tmp, '.postcssrc'),
      JSON.stringify({
        plugins: {
          'disabled-plugin': false,
          'fake-postcss-plugin': {}
        }
      })
    )
    writeFakePlugin(tmp, 'fake-postcss-plugin')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss(tmp, {mode: 'production'} as any)

    const opts = rule.options?.postcssOptions
    expect(opts?.plugins).toHaveLength(1)
    expect(opts?.plugins[0].postcssPlugin).toBe('fake-postcss-plugin')
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

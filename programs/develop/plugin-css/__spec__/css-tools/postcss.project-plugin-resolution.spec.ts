import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {PostCssOptions} from '../../css-tools/postcss'

// The resolved plugin list the rows read back.
type PluginsView =
  | (PostCssOptions & {plugins: Array<{postcssPlugin?: string}>})
  | undefined

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
    const rule = await maybeUsePostCss(tmp, {
      mode: 'production'
    })

    const opts = rule.options?.postcssOptions as PluginsView
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
    const rule = await maybeUsePostCss(tmp, {
      mode: 'production'
    })

    const opts = rule.options?.postcssOptions as PluginsView
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
    const rule = await maybeUsePostCss(tmp, {
      mode: 'production'
    })

    const opts = rule.options?.postcssOptions as PluginsView
    expect(opts?.plugins).toHaveLength(1)
    expect(opts?.plugins[0].postcssPlugin).toBe('fake-postcss-plugin')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  // A config that lists plugins keeps the rest of what it says too, and a
  // module it names resolves from the project, the way its plugins do.
  it('keeps parser, syntax, stringifier and map beside the plugins', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({}))
    fs.writeFileSync(
      path.join(tmp, '.postcssrc'),
      JSON.stringify({
        plugins: {'fake-postcss-plugin': {}},
        parser: 'fake-parser',
        syntax: 'fake-syntax',
        stringifier: 'missing-stringifier',
        map: {inline: false}
      })
    )

    writeFakePlugin(tmp, 'fake-postcss-plugin')

    for (const name of ['fake-parser', 'fake-syntax']) {
      const dir = path.join(tmp, 'node_modules', name)
      fs.mkdirSync(dir, {recursive: true})
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({name, version: '1.0.0', main: 'index.js'})
      )

      fs.writeFileSync(
        path.join(dir, 'index.js'),
        `module.exports = {from: '${name}'}`
      )
    }

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss(tmp, {
      mode: 'production'
    })
    const opts = rule.options?.postcssOptions as PluginsView

    expect(opts?.plugins).toHaveLength(1)
    expect(opts?.parser).toEqual({from: 'fake-parser'})
    expect(opts?.syntax).toEqual({from: 'fake-syntax'})
    // Left as written, so postcss-loader names the module it could not load.
    expect(opts?.stringifier).toBe('missing-stringifier')
    expect(opts?.map).toEqual({inline: false})
  })
})

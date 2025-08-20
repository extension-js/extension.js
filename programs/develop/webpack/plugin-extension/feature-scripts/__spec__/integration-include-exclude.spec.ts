import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {Configuration} from '@rspack/core'
import {ScriptsPlugin} from '..'

const tmpProject = path.join(__dirname, '.tmp-include-exclude')

const write = (file: string, content: string) => {
  const p = path.join(tmpProject, file)
  fs.mkdirSync(path.dirname(p), {recursive: true})
  fs.writeFileSync(p, content)
}

describe('ScriptsPlugin include/exclude integration (scoped)', () => {
  beforeAll(() => {
    fs.rmSync(tmpProject, {recursive: true, force: true})
    fs.mkdirSync(tmpProject, {recursive: true})
    write('manifest.json', JSON.stringify({manifest_version: 3}))
    write('a.js', 'console.log("a")')
    write('b.js', 'console.log("b")')
  })

  afterAll(() => {
    fs.rmSync(tmpProject, {recursive: true, force: true})
  })

  it('skips files present in excludeList even if included', () => {
    const config: Configuration = {
      context: tmpProject,
      entry: {},
      module: {rules: []},
      plugins: []
    }

    const plugin = new ScriptsPlugin({
      manifestPath: path.join(tmpProject, 'manifest.json'),
      includeList: {
        'background/scripts': [
          path.join(tmpProject, 'a.js'),
          path.join(tmpProject, 'b.js')
        ]
      },
      excludeList: {
        'background/scripts': [path.join(tmpProject, 'b.js')]
      }
    })

    // @ts-expect-error - partial config shape
    plugin.apply({
      options: config,
      hooks: {} as any
    } as any)

    const finalEntries = (config.entry || {}) as Record<string, any>
    // Entry for background exists
    expect(Object.keys(finalEntries)).toContain('background/scripts')
    const bgImports = (finalEntries['background/scripts'] as any)
      .import as string[]
    // Should include only a.js
    expect(bgImports.some((p) => p.endsWith('a.js'))).toBe(true)
    expect(bgImports.some((p) => p.endsWith('b.js'))).toBe(false)
  })
})

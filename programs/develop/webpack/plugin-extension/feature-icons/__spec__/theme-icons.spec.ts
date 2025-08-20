import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {beforeAll, afterAll, describe, it, expect} from 'vitest'
import {rspack} from '@rspack/core'
import {IconsPlugin} from '../index'

function mkTmpDir(prefix: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const out = path.join(tmp, 'dist')
  fs.mkdirSync(out, {recursive: true})
  return {tmp, out}
}

describe('IconsPlugin – browser_action/theme_icons', () => {
  const {tmp, out} = mkTmpDir('icons-plugin-theme-')
  const entryFile = path.join(tmp, 'entry.js')
  const manifestFile = path.join(tmp, 'manifest.json')
  const lightIcon = path.join(tmp, 'icons', 'light-16.png')
  const darkIcon = path.join(tmp, 'icons', 'dark-16.png')

  beforeAll(async () => {
    fs.mkdirSync(path.dirname(lightIcon), {recursive: true})
    fs.writeFileSync(lightIcon, Buffer.from('PNG_LIGHT'))
    fs.writeFileSync(darkIcon, Buffer.from('PNG_DARK'))
    fs.writeFileSync(entryFile, 'export default 1')
    fs.writeFileSync(
      manifestFile,
      '{"name":"x","version":"1","manifest_version":3}'
    )

    const compiler = rspack({
      context: tmp,
      mode: 'development',
      entry: entryFile,
      output: {path: out, filename: 'bundle.js', clean: true},
      plugins: [
        new IconsPlugin({
          manifestPath: manifestFile,
          includeList: {
            'browser_action/theme_icons': [
              {light: lightIcon, dark: darkIcon, size: 16}
            ]
          }
        })
      ]
    })

    await new Promise<void>((resolve, reject) => {
      compiler.run((err, stats) => {
        if (err) return reject(err)
        if (stats?.hasErrors()) return reject(new Error('Compilation failed'))
        compiler.close(() => resolve())
      })
    })
  })

  afterAll(() => {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('emits theme icons into browser_action/', () => {
    const emittedLight = path.join(
      out,
      'browser_action',
      path.basename(lightIcon)
    )
    const emittedDark = path.join(
      out,
      'browser_action',
      path.basename(darkIcon)
    )
    expect(fs.existsSync(emittedLight)).toBe(true)
    expect(fs.existsSync(emittedDark)).toBe(true)
  })
})

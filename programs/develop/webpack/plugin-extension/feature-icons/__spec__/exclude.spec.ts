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

describe('IconsPlugin – excludeList', () => {
  const {tmp, out} = mkTmpDir('icons-plugin-exclude-')
  const entryFile = path.join(tmp, 'entry.js')
  const manifestFile = path.join(tmp, 'manifest.json')
  const iconKeep = path.join(tmp, 'icons', 'keep.png')
  const iconSkip = path.join(tmp, 'icons', 'skip.png')

  beforeAll(async () => {
    fs.mkdirSync(path.dirname(iconKeep), {recursive: true})
    fs.writeFileSync(iconKeep, Buffer.from('PNG_KEEP'))
    fs.writeFileSync(iconSkip, Buffer.from('PNG_SKIP'))
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
          includeList: {icons: [iconKeep, iconSkip]},
          excludeList: {icons: iconSkip}
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

  it('emits included icons', async () => {
    const emitted = path.join(out, 'icons', path.basename(iconKeep))
    await fs.promises.access(emitted, fs.constants.F_OK)
    expect(fs.existsSync(emitted)).toBe(true)
  })

  it('does not emit excluded icons', () => {
    const notEmitted = path.join(out, 'icons', path.basename(iconSkip))
    expect(fs.existsSync(notEmitted)).toBe(false)
  })
})

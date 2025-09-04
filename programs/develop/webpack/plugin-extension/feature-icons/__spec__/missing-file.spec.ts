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

describe('IconsPlugin – missing files', () => {
  const {tmp, out} = mkTmpDir('icons-plugin-missing-')
  const entryFile = path.join(tmp, 'entry.js')
  const manifestFile = path.join(tmp, 'manifest.json')
  const missingIcon = path.join(tmp, 'icons', 'does-not-exist.png')

  let buildError: Error | null = null

  beforeAll(async () => {
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
          includeList: {icons: [missingIcon]}
        })
      ]
    })

    await new Promise<void>((resolve) => {
      compiler.run((err, stats) => {
        buildError =
          (err as Error) ||
          (stats?.hasErrors() ? new Error('Compilation failed') : null)
        compiler.close(() => resolve())
      })
    })
  })

  afterAll(() => {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('does not fail the build when an icon path is missing', () => {
    expect(buildError).toBeNull()
  })

  it('does not emit a non-existent icon', () => {
    const expected = path.join(out, 'icons', path.basename(missingIcon))
    expect(fs.existsSync(expected)).toBe(false)
  })
})

import {
  describe as d2,
  it as it2,
  expect as e2,
  beforeAll as b2,
  afterAll as a2
} from 'vitest'

d2('IconsPlugin – leading-slash paths resolve to manifest root', () => {
  const {tmp, out} = mkTmpDir('icons-plugin-leading-slash-')
  const entryFile = path.join(tmp, 'entry.js')
  const manifestFile = path.join(tmp, 'manifest.json')
  const imagesDir = path.join(tmp, 'images')
  const icon16 = path.join(imagesDir, 'get_started16.png')

  b2(async () => {
    fs.writeFileSync(entryFile, 'export default 1')
    fs.mkdirSync(imagesDir, {recursive: true})
    fs.writeFileSync(icon16, Buffer.from([1, 2, 3]))

    fs.writeFileSync(
      manifestFile,
      JSON.stringify({name: 'x', version: '1', manifest_version: 3})
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
            // simulate upstream manifest path like "/images/get_started16.png"
            icons: ['/images/get_started16.png']
          }
        })
      ]
    })

    await new Promise<void>((resolve) => {
      compiler.run((err) => {
        if (err) throw err
        compiler.close(() => resolve())
      })
    })
  })

  a2(() => {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, {recursive: true, force: true})
  })

  it2('emits the icon to dist/icons/', () => {
    const expected = path.join(out, 'icons', path.basename(icon16))
    e2(fs.existsSync(expected)).toBe(true)
  })
})

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {beforeAll, afterAll, describe, it, expect} from 'vitest'
import {rspack, Compilation, type Compiler} from '@rspack/core'
import {IconsPlugin} from '../index'

function mkTmpDir(prefix: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const out = path.join(tmp, 'dist')
  fs.mkdirSync(out, {recursive: true})
  return {tmp, out}
}

class FileDependenciesCollectorPlugin {
  public readonly collected: Set<string>
  constructor(collected: Set<string>) {
    this.collected = collected
  }
  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap('file-deps:collector', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'file-deps:collector',
          stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
        },
        () => {
          for (const dep of compilation.fileDependencies) {
            this.collected.add(dep)
          }
        }
      )
    })
  }
}

describe('IconsPlugin – fileDependencies tracking (watch support)', () => {
  const {tmp, out} = mkTmpDir('icons-plugin-filedeps-')
  const entryFile = path.join(tmp, 'entry.js')
  const manifestFile = path.join(tmp, 'manifest.json')
  const iconKeep = path.join(tmp, 'icons', 'keep.png')
  const iconSkip = path.join(tmp, 'icons', 'skip.png')

  const collectedDeps = new Set<string>()

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
        }),
        new FileDependenciesCollectorPlugin(collectedDeps)
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

  it('adds included icons to compilation.fileDependencies', () => {
    expect(Array.from(collectedDeps)).toContain(iconKeep)
  })

  it('does not track excluded icons in compilation.fileDependencies', () => {
    expect(Array.from(collectedDeps)).not.toContain(iconSkip)
  })
})

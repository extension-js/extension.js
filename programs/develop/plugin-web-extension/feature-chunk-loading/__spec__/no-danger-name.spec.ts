import type {Compiler} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  compileIssues,
  writeProject
} from '../../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {NoDangerNamePlugin} from '../steps/no-danger-name'

const makeTempFolder = trackTempFolders()

// Emits the named files in a real compile, at the stage the locales, JSON
// and icon steps emit theirs, and returns what the name check reported.
async function errorsFor(
  assetNames: string[],
  order: 'check-last' | 'check-first' = 'check-last'
): Promise<string[]> {
  const root = writeProject(makeTempFolder('extjs-output-names-'), {
    'main.js': ''
  })
  const emitter = {
    apply(compiler: Compiler) {
      const {Compilation, sources} = compiler.webpack

      compiler.hooks.thisCompilation.tap('emit-named-files', (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'emit-named-files',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          () => {
            for (const name of assetNames) {
              compilation.emitAsset(name, new sources.RawSource(''))
            }
          }
        )
      })
    }
  }
  const {errors} = await compileIssues(
    root,
    'production',
    {main: 'main.js'},
    order === 'check-first'
      ? [new NoDangerNamePlugin(), emitter]
      : [emitter, new NoDangerNamePlugin()]
  )

  return errors.map((error) => error.message)
}

describe('NoDangerNamePlugin', () => {
  it('rejects an output name that starts with an underscore', async () => {
    const errors = await errorsFor(['_runtime.js'])

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('"_runtime.js"')
    expect(errors[0]).toContain('prohibited')
  })

  // The platform requires _locales/<lang>/messages.json of every translated
  // extension, so the check must let the folder through.
  it('allows the _locales folder of a translated extension', async () => {
    expect(
      await errorsFor([
        '_locales/en/messages.json',
        '_locales/de/messages.json'
      ])
    ).toEqual([])
  })

  it('allows the _metadata folder a store writes', async () => {
    expect(await errorsFor(['_metadata/verified_contents.json'])).toEqual([])
  })

  it('leaves ordinary output names alone', async () => {
    expect(
      await errorsFor(['manifest.json', 'content_scripts/content-0.js'])
    ).toEqual([])
  })

  it('still rejects an underscore name emitted beside an allowed folder', async () => {
    const errors = await errorsFor(['_locales/en/messages.json', '_danger.js'])

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('"_danger.js"')
  })

  // The check reads what the emitting stage wrote, so where a config lists
  // it among the plugins cannot hide a name from it.
  it('rejects a name emitted by a plugin registered after it', async () => {
    const errors = await errorsFor(['_late.js'], 'check-first')

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('"_late.js"')
  })
})

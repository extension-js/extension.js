import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {rspack} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {TraceRuntimeLoadedFiles} from '../steps/trace-runtime-loaded-files'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'

// A surface the background names at runtime (an icon, a popup, a panel)
// whose file is absent, in a real compilation of that background.
const tempFolder = trackTempFolders()
const before = process.env.EXTENSION_STRICT_REFS

afterEach(() => {
  if (before === undefined) delete process.env.EXTENSION_STRICT_REFS
  else process.env.EXTENSION_STRICT_REFS = before
})

interface Report {
  name: string
  message: string
  file?: string
}

async function compiled(background: string, files: Record<string, string>) {
  const root = fs.realpathSync(tempFolder('extjs-strict-surface-'))

  const at = (...parts: string[]) => path.join(root, ...parts)

  fs.writeFileSync(at('package.json'), '{"name":"fixture"}\n')
  fs.writeFileSync(at('background.js'), background)
  fs.writeFileSync(
    at('manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'strict-surface',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(at(name), text)
  }

  return new Promise<{errors: Report[]; warnings: Report[]; root: string}>(
    (resolve, reject) => {
      const compiler = rspack({
        context: root,
        mode: 'production',
        devtool: false,
        entry: {'background/service_worker': at('background.js')},
        output: {path: at('dist'), filename: '[name].js'},
        plugins: [
          new TraceRuntimeLoadedFiles({
            manifestPath: at('manifest.json'),
            browser: 'chrome'
          })
        ]
      })

      compiler.run((error, stats) => {
        const pick = (list: Report[] = []) =>
          list.map(({name, message, file}) => ({name, message, file}))
        const errors = pick(stats?.compilation.errors as Report[])
        const warnings = pick(stats?.compilation.warnings as Report[])

        compiler.close(() => {
          if (error) reject(error)
          else resolve({errors, warnings, root})
        })
      })
    }
  )
}

const SET_ICON = 'chrome.action.setIcon({path: "gone.png"})\n'

describe('a runtime surface whose file is absent', () => {
  it('is a warning that names the file', async () => {
    delete process.env.EXTENSION_STRICT_REFS

    const {errors, warnings} = await compiled(SET_ICON, {})

    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('RuntimeSetSurfaceFileMissing')
    expect(warnings[0].message).toContain('gone.png')
    expect(warnings[0].file).toBe('background/service_worker.js')
  }, 120000)

  it('is an error under EXTENSION_STRICT_REFS=true', async () => {
    process.env.EXTENSION_STRICT_REFS = 'true'

    const {errors, warnings} = await compiled(SET_ICON, {})

    expect(warnings).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].name).toBe('RuntimeSetSurfaceFileMissing')
    expect(errors[0].message).toContain('gone.png')
    expect(errors[0].file).toBe('background/service_worker.js')
  }, 120000)

  it('is no report under strict refs when the file is there', async () => {
    process.env.EXTENSION_STRICT_REFS = 'true'

    const {errors, warnings, root} = await compiled(SET_ICON, {
      'gone.png': 'png'
    })

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    // The worker asks for the file from its own folder.
    expect(
      fs.existsSync(path.join(root, 'dist', 'background', 'gone.png'))
    ).toBe(true)
  }, 120000)
})

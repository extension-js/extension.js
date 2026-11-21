import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {getProjectStructure} from '../lib/project'
import webpackConfig from '../rspack-config'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()
const DEV_MANIFEST_STAGE = Compilation.PROCESS_ASSETS_STAGE_REPORT + 100

function project(): string {
  const root = tempFolder('extjs-dev-manifest-stage-')
  const write = (name: string, text: string) =>
    fs.writeFileSync(path.join(root, name), text)

  write('package.json', JSON.stringify({private: true, name: 'stage'}))
  write('background.js', 'chrome.scripting.executeScript({})\n')
  write('content.js', 'console.log("content")\n')
  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'stage',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [{matches: ['https://a.example/*'], js: ['content.js']}]
    })
  )

  return root
}

interface Seen {
  taps: string[]
  permissionsBefore: string[]
  permissionsAfter: string[]
  warnings: string[]
}

// Records every step that taps the stage the dev manifest is written at, in
// the order they run, and reads the manifest asset on each side of the stage.
async function compile(mode: 'development' | 'production'): Promise<Seen> {
  const root = project()
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode,
    metadataCommand: mode === 'development' ? 'dev' : 'build',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'chrome')}
  })
  const seen: Seen = {
    taps: [],
    permissionsBefore: [],
    permissionsAfter: [],
    warnings: []
  }
  const permissionsOf = (compilation: Compilation): string[] =>
    (
      JSON.parse(
        String(compilation.getAsset('manifest.json')?.source.source() || '{}')
      ) as {permissions?: string[]}
    ).permissions || []
  const probe = {
    apply(compiler: Compiler) {
      compiler.hooks.thisCompilation.tap('stage-probe', (compilation) => {
        const hook = compilation.hooks.processAssets
        const tap = hook.tap.bind(hook)

        hook.tap = ((options, handler) => {
          if (
            typeof options !== 'string' &&
            options.stage === DEV_MANIFEST_STAGE
          ) {
            seen.taps.push(options.name)
          }

          return tap(options, handler)
        }) as typeof hook.tap

        tap({name: 'before', stage: DEV_MANIFEST_STAGE - 1}, () => {
          seen.permissionsBefore = permissionsOf(compilation)
        })

        tap({name: 'after', stage: DEV_MANIFEST_STAGE + 1}, () => {
          seen.permissionsAfter = permissionsOf(compilation)
        })
      })
    }
  }

  config.plugins = [
    probe,
    ...(config.plugins || []).filter(
      (plugin) => plugin?.constructor.name !== 'plugin-browsers'
    )
  ]

  if (mode === 'development') {
    config.plugins.push(new rspack.HotModuleReplacementPlugin())
  }

  config.stats = false

  const compiler = rspack(config)

  await new Promise<void>((resolve, reject) => {
    compiler.run((error, stats) => {
      seen.warnings = (stats?.compilation.warnings || []).map(
        (warning) => warning.name
      )

      compiler.close(() => (error ? reject(error) : resolve()))
    })
  })

  return seen
}

describe('the stage the dev manifest is written at', () => {
  // The dev manifest is the last thing written at the stage, so every step
  // of a later stage reads the grants and no step of this one does.
  it('runs these steps in this order in a dev session', async () => {
    const seen = await compile('development')

    expect(seen.taps).toEqual([
      'compatibility:warn-browser-global',
      'manifest:apply-dev-defaults'
    ])

    expect(seen.permissionsBefore).toEqual([])
    expect(seen.permissionsAfter).toEqual(['scripting', 'tabs', 'storage'])
    // The source leans on a permission only the session granted.
    expect(seen.warnings).toEqual(['DevInjectedPermissionWarning'])
  })

  // A build grants nothing: the scan warns and the manifest stays as written.
  it('runs these steps in this order in a build', async () => {
    const seen = await compile('production')

    expect(seen.taps).toEqual([
      'compatibility:warn-browser-global',
      'manifest:warn-undeclared-permissions',
      'scripts:warn-missing-build-constants'
    ])

    expect(seen.permissionsBefore).toEqual([])
    expect(seen.permissionsAfter).toEqual([])
    expect(seen.warnings).toEqual(['UndeclaredPermissionWarning'])
  })
})

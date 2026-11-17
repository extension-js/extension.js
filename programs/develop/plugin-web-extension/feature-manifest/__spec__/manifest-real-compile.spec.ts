import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  Compilation,
  type Compiler,
  rspack,
  type Stats,
  sources
} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {suppressManifestOutputWrites} from '../../../dev-server'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'

type Mode = 'development' | 'production'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  manifest: Record<string, unknown> = {},
  files: Record<string, string> = {}
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-manifest-compile-'))
  )
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'manifest-compile', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'manifest-compile',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      ...manifest
    })
  )

  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), text)
  }

  return root
}

// What a project's own plugin does: read the asset, change it, put it back.
class EditManifestAsset {
  constructor(
    private readonly stage: number,
    private readonly edit: (manifest: Record<string, unknown>) => void
  ) {}

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap('user:edit-manifest', (compilation) => {
      compilation.hooks.processAssets.tap(
        {name: 'user:edit-manifest', stage: this.stage},
        () => {
          const asset = compilation.getAsset('manifest.json')
          if (!asset) return

          const manifest = JSON.parse(asset.source.source().toString())
          this.edit(manifest)

          compilation.updateAsset(
            'manifest.json',
            new sources.RawSource(JSON.stringify(manifest, null, 2))
          )
        }
      )
    })
  }
}

async function configure(root: string, mode: Mode, plugins: unknown[] = []) {
  const distPath = path.join(root, 'dist', 'chrome')
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode,
    metadataCommand: mode === 'development' ? 'dev' : 'build',
    silent: true,
    output: {clean: false, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) => plugin?.constructor.name !== 'plugin-browsers'
  )

  if (mode === 'development') {
    config.plugins.push(new rspack.HotModuleReplacementPlugin())
  }

  // A project's plugins come after the built-in ones, as its config hook
  // appends them.
  config.plugins.push(...(plugins as never[]))
  config.stats = false

  return {config, distPath}
}

async function compile(root: string, mode: Mode, plugins: unknown[] = []) {
  const {config, distPath} = await configure(root, mode, plugins)
  const manifestOutputPath = path.join(distPath, 'manifest.json')
  const compiler: Compiler = rspack(config)

  // A dev session keeps rspack from writing the manifest itself, so the
  // file on disk there is only what the persist step writes.
  const release =
    mode === 'development'
      ? suppressManifestOutputWrites(compiler, manifestOutputPath)
      : () => {}

  try {
    const stats = await new Promise<Stats>((resolve, reject) => {
      compiler.run((error, result) => {
        compiler.close(() => {
          if (error || !result) return reject(error || new Error('no stats'))

          resolve(result)
        })
      })
    })

    return {
      stats,
      manifest: (fs.existsSync(manifestOutputPath)
        ? JSON.parse(fs.readFileSync(manifestOutputPath, 'utf8'))
        : undefined) as Record<string, unknown> | undefined
    }
  } finally {
    release()
  }
}

const STAGES: Array<[string, number]> = [
  ['before the paths are resolved', Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE],
  ['at the analyse stage', Compilation.PROCESS_ASSETS_STAGE_ANALYSE],
  ['at the report stage', Compilation.PROCESS_ASSETS_STAGE_REPORT],
  ['after every built-in step', Compilation.PROCESS_ASSETS_STAGE_REPORT + 5000]
]

describe('a project plugin that edits the manifest.json asset', () => {
  for (const mode of ['development', 'production'] as const) {
    for (const [label, stage] of STAGES) {
      it(`has its edit on disk in ${mode} when it runs ${label}`, async () => {
        const {stats, manifest} = await compile(project(), mode, [
          new EditManifestAsset(stage, (edited) => {
            edited.short_name = 'edited by the project'
            edited.version = '9.9.9'
          })
        ])

        expect(stats.hasErrors()).toBe(false)
        expect(manifest?.short_name).toBe('edited by the project')
        expect(manifest?.version).toBe('9.9.9')
        // The built-in rewrites still ran on the same manifest.
        expect(manifest?.background).toEqual({
          service_worker: 'background/service_worker.js'
        })
      })
    }
  }
})

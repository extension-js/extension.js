import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeProjectFiles} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// A wasm runtime such as @ffmpeg/core ships files its `exports` field does
// not list. The build resolves them like any package file, with no alias.
const tempFolder = trackTempFolders()

const REQUEST = '@ffmpeg/core/dist/esm/ffmpeg-core.js'

const ALIAS_CONFIG = [
  "const path = require('node:path')",
  '',
  'module.exports = {',
  '  config: (config) => {',
  '    config.resolve.alias = {',
  '      ...config.resolve.alias,',
  `      '${REQUEST}': path.resolve(__dirname, 'node_modules/${REQUEST}')`,
  '    }',
  '',
  '    return config',
  '  }',
  '}',
  ''
].join('\n')

// A fake package named like the real one, written here. Nothing is installed.
function project(config?: string) {
  const root = fs.realpathSync(tempFolder('extjs-hidden-subpath-'))

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'hidden-subpath',
      version: '0.0.0'
    }),
    'node_modules/@ffmpeg/core/package.json': JSON.stringify({
      name: '@ffmpeg/core',
      version: '1.0.0',
      exports: {'.': './index.js'}
    }),
    'node_modules/@ffmpeg/core/index.js': 'export default "main"\n',
    [`node_modules/${REQUEST}`]: 'export default "HIDDEN_CORE"\n',
    'background.js': `import core from "${REQUEST}"\nconsole.log(core)\n`,
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'hidden-subpath',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
    ...(config ? {'extension.config.js': config} : {})
  }

  writeProjectFiles(root, files)

  return root
}

async function build(root: string) {
  const printed: string[] = []
  const spies = (['log', 'error', 'warn', 'info'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      printed.push(args.join(' '))
    })
  )

  try {
    const summary = await buildProject(root, {
      silent: undefined,
      mode: 'production'
    })

    return {printed, errors: summary.errors_count, thrown: undefined}
  } catch (error) {
    return {printed, errors: undefined, thrown: String(error)}
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

describe('an import of a file the package exports field hides', () => {
  it('fails the build with the resolver error and names the importer', async () => {
    const root = project()
    const result = await build(root)

    expect(result.thrown).toBe('Error: Build failed with errors')
    expect(result.printed).toContain(
      '⏵⏵⏵ Build error in ./background.js 1:1-57.\n' +
        `    × Package subpath './dist/esm/ffmpeg-core.js' is not defined by "exports" in ${path.join(root, 'node_modules/@ffmpeg/core/package.json')}\n`
    )
  }, 120_000)

  it('builds once extension.config.js sets an alias to the file', async () => {
    const root = project(ALIAS_CONFIG)
    const result = await build(root)

    expect(result.thrown).toBeUndefined()
    expect(result.errors).toBe(0)
    expect(
      fs.readFileSync(
        path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
        'utf8'
      )
    ).toContain('HIDDEN_CORE')
  }, 120_000)
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {RspackDevServer} from '@rspack/dev-server'
import {afterAll, beforeEach, describe, expect, it} from 'vitest'
import {writeProjectFiles} from '../../__spec__/helpers/extension-project'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'
import {buildServerConfig} from '../server-config'
import {skipWithoutDevelopDist} from './helpers/develop-dist'
import {
  bootLoopback,
  createFixture,
  freeLoopbackPort
} from './helpers/loopback-dev-server'

type WebpackConfigOptions = Parameters<typeof webpackConfig>[1]

const tempFolder = trackTempFolders()
const tracked: string[] = []

afterAll(() => {
  for (const root of tracked) fs.rmSync(root, {recursive: true, force: true})
})

// Every place the build copies a file through under the name it has on disk.
const NESTED_MANIFESTS = [
  'app/manifest.json',
  'deep/a/b/manifest.json',
  'vendor/helper/manifest.json',
  'bundled/companion/manifest.json'
]

const SOURCE_OF: Record<string, string> = {
  'app/manifest.json': 'public/app/manifest.json',
  'deep/a/b/manifest.json': 'public/deep/a/b/manifest.json',
  'vendor/helper/manifest.json': 'helper/manifest.json',
  'bundled/companion/manifest.json': 'bundled/companion/manifest.json'
}

const INCLUDE = {
  'vendor/helper/manifest.json': './helper/manifest.json',
  bundled: './bundled'
}

function scaffold() {
  const root = tempFolder('extjs-nested-manifest-')
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'nested-manifest',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'nested-manifest',
      version: '0.0.0',
      background: {service_worker: 'background.js'}
    }),
    'background.js': "console.log('nested manifest fixture')\n",
    'public/app/manifest.json': '{"name":"web app","display":"standalone"}',
    'public/deep/a/b/manifest.json': '{"where":"deep"}',
    'helper/manifest.json': '{"where":"include file"}',
    'bundled/companion/manifest.json':
      '{"manifest_version":3,"name":"companion","version":"1.0.0"}',
    'bundled/companion/note.txt': 'beside the companion manifest\n'
  }

  writeProjectFiles(root, files)

  return root
}

async function compilerFor(root: string, mode: 'development' | 'production') {
  const distPath = path.join(root, 'dist', 'chrome')
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode,
    metadataCommand: mode === 'development' ? 'dev' : 'build',
    silent: true,
    include: INCLUDE,
    output: {clean: false, path: distPath}
  } as WebpackConfigOptions)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  return {compiler: rspack(config) as Compiler, distPath}
}

function errorsOf(stats: Stats) {
  return stats.compilation.errors.map((error) => String(error.message))
}

function filesUnder(directory: string, prefix = ''): string[] {
  if (!fs.existsSync(directory)) return []

  return fs
    .readdirSync(directory, {withFileTypes: true})
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(
            path.join(directory, entry.name),
            `${prefix}${entry.name}/`
          )
        : [`${prefix}${entry.name}`]
    )
    .sort()
}

// The file list of one first dev compile, written by the real server config.
async function devFilesOnDisk(root: string) {
  const {compiler, distPath} = await compilerFor(root, 'development')
  const firstCompile = new Promise<Stats>((resolve) => {
    compiler.hooks.done.tap('nested-manifest-spec', resolve)
  })
  const port = await freeLoopbackPort()
  const server = new RspackDevServer(
    buildServerConfig({
      host: '127.0.0.1',
      port,
      connectableHost: '127.0.0.1',
      emulatorOrigin: null,
      isSessionExtensionOrigin: () => false,
      publicFolder: path.join(root, 'public'),
      emulatorFiles: null,
      activeCompiler: () => compiler,
      onHostRefused: () => {},
      onSiteRefused: () => {},
      server: undefined,
      socketPath: '/ws/nested-manifest'
    }),
    compiler
  )

  await server.start()

  try {
    const errors = errorsOf(await firstCompile)

    return {errors, distPath, files: filesUnder(distPath)}
  } finally {
    await server.stop()
  }
}

async function productionFilesOnDisk(root: string) {
  const {compiler, distPath} = await compilerFor(root, 'production')
  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) =>
      error || !result ? reject(error) : resolve(result)
    )
  })

  await new Promise<void>((resolve) => compiler.close(() => resolve()))

  return {errors: errorsOf(stats), distPath, files: filesUnder(distPath)}
}

const manifestsIn = (files: string[]) =>
  files.filter((file) => path.posix.basename(file) === 'manifest.json')

beforeEach(skipWithoutDevelopDist)

describe('nested manifest.json files in the dev output folder', () => {
  it('a production build ships every nested manifest.json', async () => {
    const production = await productionFilesOnDisk(scaffold())

    expect(production.errors).toEqual([])
    expect(manifestsIn(production.files)).toEqual(
      [...NESTED_MANIFESTS, 'manifest.json'].sort()
    )
  }, 120_000)

  it('dev writes every nested manifest.json a production build ships', async () => {
    const devRoot = scaffold()
    const dev = await devFilesOnDisk(devRoot)
    const production = await productionFilesOnDisk(scaffold())

    expect(dev.errors).toEqual([])
    expect(manifestsIn(dev.files)).toEqual(manifestsIn(production.files))
    expect(
      production.files.filter((file) => !dev.files.includes(file))
    ).toEqual([])

    for (const relative of NESTED_MANIFESTS) {
      expect(fs.readFileSync(path.join(dev.distPath, relative), 'utf8')).toBe(
        fs.readFileSync(path.join(devRoot, SOURCE_OF[relative]), 'utf8')
      )
    }

    // The root one is the generated manifest, written by the manifest step.
    expect(
      JSON.parse(
        fs.readFileSync(path.join(dev.distPath, 'manifest.json'), 'utf8')
      ).name
    ).toBe('nested-manifest')
  }, 120_000)

  it('the dev server itself never writes the root manifest.json', async () => {
    const root = createFixture('extjs-nested-manifest-loopback-')
    tracked.push(root)
    // No manifest step runs here, so only the dev server could write it.
    const session = await bootLoopback({
      root,
      beforeServer: (compiler) => {
        compiler.hooks.thisCompilation.tap('nested-manifest', (compilation) => {
          compilation.hooks.processAssets.tap('nested-manifest', () => {
            compilation.emitAsset(
              'app/manifest.json',
              new compiler.webpack.sources.RawSource('{"nested":true}')
            )
          })
        })
      }
    })

    try {
      await session.firstCompile

      expect(filesUnder(session.distPath)).toEqual([
        'app/manifest.json',
        'background.js'
      ])
    } finally {
      await session.server.stop()
    }
  }, 60_000)
})

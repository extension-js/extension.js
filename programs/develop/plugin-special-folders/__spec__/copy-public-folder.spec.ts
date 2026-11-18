import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {SpecialFoldersPlugin} from '..'
import {
  compileFixture,
  type FixtureBuild,
  type FixtureFiles,
  removeFixtureRoots
} from './helpers/compile-harness'

afterEach(() => {
  removeFixtureRoots()
})

const ENTRY = {'index.js': 'self.out = 1\n'}

async function build(
  files: FixtureFiles,
  options: {
    manifest?: string
    mode?: 'development' | 'production'
    folders?: {public?: string | false}
  } = {}
): Promise<FixtureBuild> {
  const manifest = options.manifest || 'manifest.json'
  const result = await compileFixture({
    files: {...ENTRY, [manifest]: '{"manifest_version": 3}', ...files},
    mode: options.mode,
    plugins: [
      {
        apply(compiler) {
          new SpecialFoldersPlugin({
            manifestPath: path.join(String(compiler.options.context), manifest),
            folders: options.folders
          }).apply(compiler)
        }
      }
    ]
  })

  // Every compile writes inside its own temp folder, never into the repo.
  expect(result.outputPath).toBe(path.join(result.root, 'dist'))
  expect(
    path.relative(fs.realpathSync(os.tmpdir()), result.root).startsWith('..')
  ).toBe(false)

  return result
}

const copied = (result: FixtureBuild) =>
  Object.entries(result.assets)
    .filter(([, info]) => info.copied)
    .map(([name]) => name)
    .sort()

describe('SpecialFoldersPlugin copies public/ in a real compile', () => {
  it('ships public/ as authored, minus the root manifest and locale metadata', async () => {
    const result = await build({
      'public/logo.txt': 'logo',
      'public/manifest.json': '{"name": "public copy"}',
      'public/nested/manifest.json': '{"nested": true}',
      'public/_locales/en/messages.json': '{"a": {"message": "A"}}',
      'public/_locales/en/.DS_Store': 'finder',
      'public/_locales/xx/readme.txt': 'no messages here'
    })

    expect(copied(result)).toEqual([
      '_locales/en/messages.json',
      'logo.txt',
      'nested/manifest.json'
    ])

    expect(Object.keys(result.assets).sort()).toEqual([
      '_locales/en/messages.json',
      'logo.txt',
      'main.js',
      'nested/manifest.json'
    ])
  })

  it('wires no copier when public/ is not there yet and waits for it by path', async () => {
    const result = await build({}, {mode: 'development'})

    expect(copied(result)).toEqual([])
    expect(result.missingDependencies).toContain(
      path.join(result.root, 'public')
    )

    expect(result.contextDependencies).not.toContain(result.root)
  })

  it('reads no folder at all when public is turned off', async () => {
    const result = await build(
      {'public/logo.txt': 'logo'},
      {folders: {public: false}, mode: 'development'}
    )

    expect(copied(result)).toEqual([])
    expect(result.missingDependencies).not.toContain(
      path.join(result.root, 'public')
    )

    expect(result.contextDependencies).not.toContain(
      path.join(result.root, 'public')
    )
  })

  it('refuses a manifest.json at the root of public/', async () => {
    const result = await build({
      'public/manifest.json': '{"name": "public copy"}'
    })

    expect(result.errors.map((error) => error.message)).toContain(
      `manifest.json must not be placed under public/: ${path.join(result.root, 'public', 'manifest.json')}`
    )

    expect(result.assets['manifest.json']).toBeUndefined()
    // A production build with an error writes nothing at all.
    expect(result.emitted).toEqual({})
  })

  it('watches pages/ and scripts/ in development only', async () => {
    const development = await build({}, {mode: 'development'})
    const production = await build({}, {mode: 'production'})

    for (const folder of ['pages', 'scripts']) {
      expect(development.missingDependencies).toContain(
        path.join(development.root, folder)
      )

      expect(production.missingDependencies).not.toContain(
        path.join(production.root, folder)
      )
    }
  })

  it('copies from the folder beside the manifest and notes the placement', async () => {
    const result = await build(
      {'src/public/beside.txt': 'beside'},
      {manifest: 'src/manifest.json'}
    )

    expect(copied(result)).toEqual(['beside.txt'])
    const layout = result.warnings.filter(
      (warning) => warning.name === 'PublicLayoutWarning'
    )
    expect(layout).toHaveLength(1)
    // Both rows print relative to the project, the way the card prints paths.
    expect(layout[0].message).toMatch(/^GOT src[\\/]public$/m)
    expect(layout[0].message).toMatch(/^EXPECTED public$/m)
  })

  it('ships the project-root folder when both exist and names the winner', async () => {
    const result = await build(
      {
        'public/root.txt': 'root',
        'src/public/beside.txt': 'beside'
      },
      {manifest: 'src/manifest.json'}
    )

    expect(copied(result)).toEqual(['root.txt'])
    const shadowed = result.warnings.filter(
      (warning) => warning.name === 'PublicFolderShadowedWarning'
    )
    expect(shadowed).toHaveLength(1)
    expect(shadowed[0].message).toMatch(/^USING public$/m)
    expect(shadowed[0].message).toMatch(/^IGNORED src[\\/]public$/m)
  })
})

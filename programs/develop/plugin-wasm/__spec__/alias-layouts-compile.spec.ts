import * as path from 'node:path'
import type {RspackPluginInstance} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {
  compileFixture,
  type FixtureFiles,
  makeFixtureRoot,
  removeFixtureRoots
} from '../../plugin-static-assets/__spec__/helpers/compile-harness'
import {WasmPlugin} from '../index'

afterAll(() => removeFixtureRoots())

const REQUEST = '@ffmpeg/core/dist/esm/ffmpeg-core.js'

// A fake package named like the real one, written by the test. No install.
function ffmpegCore(
  prefix: string,
  label: string,
  exportsField?: Record<string, string>
): FixtureFiles {
  const dir = `${prefix}node_modules/@ffmpeg/core`

  return {
    [`${dir}/package.json`]: JSON.stringify({
      name: '@ffmpeg/core',
      version: '1.0.0',
      main: './index.js',
      ...(exportsField ? {exports: exportsField} : {})
    }),
    [`${dir}/index.js`]: 'export default "main"\n',
    [`${dir}/dist/esm/ffmpeg-core.js`]: `export default "${label}"\n`
  }
}

const INDEX = `import core from '${REQUEST}'\nself.out = {core}\n`

// The alias walk starts from a temp folder, never from the repository.
function withAliases(start: string): RspackPluginInstance {
  return {apply: (compiler) => new WasmPlugin().apply(compiler, start)}
}

async function compileBoth(files: FixtureFiles, start = makeFixtureRoot({})) {
  const config = () => ({resolve: {extensions: ['.js', '.json']}})
  const bare = await compileFixture({files, plugins: [], config})
  const aliased = await compileFixture({
    files,
    plugins: [withAliases(start)],
    config
  })

  return {bare, aliased}
}

describe('the ffmpeg-core alias against plain resolution', () => {
  it('changes nothing for a package installed in the project that exposes the file', async () => {
    const {bare, aliased} = await compileBoth({
      ...ffmpegCore('', 'project copy'),
      'index.js': INDEX
    })

    expect(bare.errors).toEqual([])
    expect(aliased.errors).toEqual([])
    expect(await bare.evaluate()).toEqual({core: 'project copy'})
    expect(await aliased.evaluate()).toEqual({core: 'project copy'})
    expect(aliased.main).toBe(bare.main)
  })

  it('reaches a file the package exports field hides', async () => {
    const {bare, aliased} = await compileBoth({
      ...ffmpegCore('', 'hidden file', {'.': './index.js'}),
      'index.js': INDEX
    })

    expect(await aliased.evaluate()).toEqual({core: 'hidden file'})
    expect(bare.errors).toEqual([
      `  × Package subpath './dist/esm/ffmpeg-core.js' is not defined by "exports" in ${path.join(bare.root, 'node_modules/@ffmpeg/core/package.json')}\n`
    ])
  })

  it('finds a copy that exists only above the start folder', async () => {
    const elsewhere = makeFixtureRoot(ffmpegCore('', 'copy above the start'))
    const start = path.join(elsewhere, 'nested', 'folder')

    const {bare, aliased} = await compileBoth({'index.js': INDEX}, start)

    expect(await aliased.evaluate()).toEqual({core: 'copy above the start'})
    expect(bare.errors).toHaveLength(1)
    expect(bare.errors[0]).toContain(
      `Module not found: Can't resolve '${REQUEST}'`
    )
  })

  it('hands a dependency the top-level copy instead of its own nested one', async () => {
    const {bare, aliased} = await compileBoth({
      ...ffmpegCore('', 'top-level copy'),
      ...ffmpegCore('node_modules/wrapper/', 'nested copy'),
      'node_modules/wrapper/package.json': JSON.stringify({
        name: 'wrapper',
        version: '1.0.0',
        main: './index.js'
      }),
      'node_modules/wrapper/index.js': `export {default} from '${REQUEST}'\n`,
      'index.js': "import core from 'wrapper'\nself.out = {core}\n"
    })

    expect(await bare.evaluate()).toEqual({core: 'nested copy'})
    expect(await aliased.evaluate()).toEqual({core: 'top-level copy'})
  })
})

import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  compileFixture,
  type FixtureFiles,
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

// `bare` is rspack alone, `built` adds the plugin. They must agree.
async function compileBoth(files: FixtureFiles) {
  const config = () => ({resolve: {extensions: ['.js', '.json']}})
  const bare = await compileFixture({files, plugins: [], config})
  const built = await compileFixture({
    files,
    plugins: [new WasmPlugin()],
    config
  })

  return {bare, built}
}

describe('a known wasm runtime file resolves like any other package file', () => {
  it('resolves a file the package installed in the project exposes', async () => {
    const {bare, built} = await compileBoth({
      ...ffmpegCore('', 'project copy'),
      'index.js': INDEX
    })

    expect(built.errors).toEqual([])
    expect(await built.evaluate()).toEqual({core: 'project copy'})
    expect(built.main).toBe(bare.main)
  })

  it('refuses a file the package exports field hides, and a user alias reaches it', async () => {
    const files = {
      ...ffmpegCore('', 'hidden file', {'.': './index.js'}),
      'index.js': INDEX
    }
    const {bare, built} = await compileBoth(files)
    const hidden = (root: string) =>
      path.join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js')

    expect(built.errors).toEqual([
      `  × Package subpath './dist/esm/ffmpeg-core.js' is not defined by "exports" in ${path.join(built.root, 'node_modules/@ffmpeg/core/package.json')}\n`
    ])

    expect(built.errors[0].replace(built.root, bare.root)).toBe(bare.errors[0])

    const aliased = await compileFixture({
      files,
      plugins: [new WasmPlugin()],
      config: (root) => ({
        resolve: {
          extensions: ['.js', '.json'],
          alias: {[REQUEST]: hidden(root)}
        }
      })
    })

    expect(aliased.errors).toEqual([])
    expect(await aliased.evaluate()).toEqual({core: 'hidden file'})
  })

  it('does not look for a copy outside the folders rspack searches', async () => {
    const {bare, built} = await compileBoth({'index.js': INDEX})

    expect(built.errors).toHaveLength(1)
    expect(built.errors[0]).toContain(
      `Module not found: Can't resolve '${REQUEST}'`
    )

    expect(bare.errors).toHaveLength(1)
  })

  it('hands a dependency its own nested copy', async () => {
    const {bare, built} = await compileBoth({
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

    expect(await built.evaluate()).toEqual({core: 'nested copy'})
    expect(built.main).toBe(bare.main)
  })
})

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

// Obvious fakes: no file here holds a real value.
const MARKER = 'FAKE-MARKER-NOT-A-REAL-VALUE'
const env = (name: string) => `EXAMPLE_KEY=${MARKER}-${name}\n`

async function build(files: FixtureFiles): Promise<FixtureBuild> {
  const result = await compileFixture({
    files: {
      'index.js': 'self.out = 1\n',
      'manifest.json': '{"manifest_version": 3}',
      ...files
    },
    plugins: [
      {
        apply(compiler) {
          new SpecialFoldersPlugin({
            manifestPath: path.join(
              String(compiler.options.context),
              'manifest.json'
            )
          }).apply(compiler)
        }
      }
    ]
  })

  expect(result.outputPath).toBe(path.join(result.root, 'dist'))

  return result
}

describe('files in public/ that are not extension content', () => {
  it('copies env files and OS metadata into the output folder', async () => {
    const result = await build({
      'public/logo.txt': 'logo',
      'public/.env': env('root'),
      'public/cfg/.env.local': env('nested'),
      'public/.DS_Store': 'finder'
    })

    // Pins today's behavior.
    expect(Object.keys(result.emitted).sort()).toEqual([
      '.DS_Store',
      '.env',
      'cfg/.env.local',
      'logo.txt',
      'main.js'
    ])

    expect(result.emitted['.env']).toContain(MARKER)
    expect(result.emitted['cfg/.env.local']).toContain(MARKER)
    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
  })
})

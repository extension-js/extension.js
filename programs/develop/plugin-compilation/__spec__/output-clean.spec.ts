import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest'
import {CompilationPlugin} from '../index'
import {
  compile,
  makeTempRoot,
  removeTempRoots,
  writeFiles
} from './helpers/real-compile'

// rspack-config passes devOptions.output.clean straight to output.clean, and
// the dev server and the build both pass false. Only rspack ever cleans.
function scaffold() {
  const root = makeTempRoot('output-clean')
  writeFiles(root, {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'Clean',
      version: '1.0.0'
    }),
    'background.js': 'globalThis.ran = 1\n',
    'dist/chrome/stale.js': 'stale',
    'dist/chrome/nested/stale.txt': 'stale',
    'dist/firefox/kept.js': 'other browser'
  })

  return root
}

async function build(
  root: string,
  outputPath: string,
  outputClean: boolean,
  mode: 'development' | 'production'
) {
  return compile({
    context: root,
    outputPath,
    outputClean,
    mode,
    entry: {background: './background.js'},
    plugins: [
      new CompilationPlugin({
        manifestPath: path.join(root, 'manifest.json'),
        browser: 'chrome',
        command: mode === 'production' ? 'build' : 'dev'
      })
    ]
  })
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterAll(() => {
  vi.restoreAllMocks()
  removeTempRoots()
})

describe('output folder cleaning', () => {
  for (const mode of ['development', 'production'] as const) {
    it(`removes stale files under output.path with output.clean, ${mode}`, async () => {
      const root = scaffold()
      const dist = path.join(root, 'dist', 'chrome')
      const stats = await build(root, dist, true, mode)

      expect(stats.hasErrors()).toBe(false)
      expect(fs.readdirSync(dist).sort()).toEqual(['background.js'])
      // Scoped to output.path: a sibling browser folder stays.
      expect(
        fs.readFileSync(path.join(root, 'dist/firefox/kept.js'), 'utf8')
      ).toBe('other browser')
    })
  }

  it('keeps earlier output in the dev shape, where output.clean is false', async () => {
    const root = scaffold()
    const dist = path.join(root, 'dist', 'chrome')
    await build(root, dist, false, 'development')

    expect(fs.readdirSync(dist).sort()).toEqual([
      'background.js',
      'nested',
      'stale.js'
    ])
  })

  it('leaves the live dist alone when the build emits into a staging sibling', async () => {
    const root = scaffold()
    const staging = path.join(root, 'dist', '.staging-chrome-1')
    await build(root, staging, false, 'production')

    expect(fs.readdirSync(staging)).toEqual(['background.js'])
    expect(fs.readdirSync(path.join(root, 'dist', 'chrome')).sort()).toEqual([
      'nested',
      'stale.js'
    ])
  })

  it('creates an output folder that does not exist yet', async () => {
    const root = scaffold()
    const fresh = path.join(root, 'out', 'chrome')
    await build(root, fresh, true, 'production')

    expect(fs.readdirSync(fresh)).toEqual(['background.js'])
  })
})

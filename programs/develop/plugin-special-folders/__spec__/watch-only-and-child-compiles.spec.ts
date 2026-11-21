import * as path from 'node:path'
import {type Compiler, EntryPlugin} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {
  closeCompiler,
  fixtureCompiler,
  makeFixtureRoot,
  removeFixtureRoots,
  runCompiler,
  watchFixture
} from '../../__spec__/helpers/compile-harness'
import {rememberSpecialFoldersConfig} from '../../lib/special-folders/folders-config'
import {SpecialFoldersPlugin} from '..'
import {HintImportOnlyScripts} from '../hint-import-only-scripts'

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rememberSpecialFoldersConfig(root, undefined)
  }

  removeFixtureRoots()
})

function project(files: Record<string, string>): string {
  const root = makeFixtureRoot(files)
  fixtureRoots.push(root)

  return root
}

const specialFolders = {
  apply(compiler: Compiler) {
    new SpecialFoldersPlugin({
      manifestPath: path.join(String(compiler.options.context), 'manifest.json')
    }).apply(compiler)
  }
}

const MANIFEST = JSON.stringify({manifest_version: 3, name: 'x', version: '1'})

// A one-shot build leaves them unwatched, see the public folder copy spec.
describe('the steps a watch session alone needs', () => {
  it('watch the folders a dev session may add pages or scripts to', async () => {
    const root = project({'manifest.json': MANIFEST, 'index.js': '1\n'})
    const compiler = fixtureCompiler({
      root,
      mode: 'development',
      plugins: [specialFolders]
    })
    const watch = watchFixture(root, compiler)

    try {
      const first = await watch.waitForBuild(1, 60_000)

      expect(first?.missingDependencies).toContain(path.join(root, 'pages'))
      expect(first?.missingDependencies).toContain(path.join(root, 'scripts'))
    } finally {
      await watch.close()
    }
  }, 90_000)
})

// A child compile that builds a scripts entry of its own, as a loader or an
// HTML step may.
const childCompile = {
  apply(compiler: Compiler) {
    compiler.hooks.make.tapPromise('child-compile', async (compilation) => {
      const child = compilation.createChildCompiler(
        'child-compile',
        {filename: 'child-[name].js'},
        [new EntryPlugin(compiler.context, './scripts/main.js', 'child')]
      )

      await new Promise<void>((resolve, reject) => {
        child.runAsChild((error) => (error ? reject(error) : resolve()))
      })
    })
  }
}

describe('the hint about scripts that other files only import', () => {
  it('is said by the extension build and never by a child compile', async () => {
    const root = project({
      'manifest.json': MANIFEST,
      'scripts/main.js': "import {helper} from './helper.js'\nhelper()\n",
      'scripts/helper.js': 'export function helper() {}\n'
    })
    const compiler = fixtureCompiler({
      root,
      entry: {
        'scripts/main': './scripts/main.js',
        'scripts/helper': './scripts/helper.js'
      },
      plugins: [new HintImportOnlyScripts(), childCompile]
    })
    const childWarnings: string[] = []

    compiler.hooks.done.tap('read-children', (stats) => {
      for (const child of stats.compilation.children) {
        childWarnings.push(...child.warnings.map((warning) => warning.name))
      }
    })

    try {
      const build = await runCompiler(root, compiler)
      const hints = build.warnings.filter(
        (warning) => warning.name === 'ScriptsFolderEntryOnlyImported'
      )

      expect(hints).toHaveLength(1)
      expect(childWarnings).not.toContain('ScriptsFolderEntryOnlyImported')
    } finally {
      await closeCompiler(compiler)
    }
  })
})

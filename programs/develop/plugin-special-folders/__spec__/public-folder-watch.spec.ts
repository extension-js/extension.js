import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {SpecialFoldersPlugin} from '..'
import {
  buildWith,
  fixtureCompiler,
  makeFixtureRoot,
  removeFixtureRoots,
  watchFixture
} from './helpers/compile-harness'

// A file only the copier ships has no module that imports it, so the watch
// session must see public/ itself for an edit, an addition or a deletion.

afterEach(() => {
  removeFixtureRoots()
})

const NEXT_BUILD_MS = 10_000

function session(files: Record<string, string>) {
  const root = makeFixtureRoot({
    'index.js': 'self.out = 1\n',
    'manifest.json': '{"manifest_version": 3}',
    ...files
  })
  const compiler = fixtureCompiler({
    root,
    mode: 'development',
    plugins: [
      new SpecialFoldersPlugin({manifestPath: path.join(root, 'manifest.json')})
    ]
  })

  return {root, watch: watchFixture(root, compiler)}
}

describe('a watch session over public/', () => {
  it('recompiles and ships an edit, an addition and a deletion', async () => {
    const {root, watch} = session({'public/rules.json': '{"v": 1}'})
    const next = () => watch.builds.length + 1

    try {
      const first = await watch.waitForBuild(1, NEXT_BUILD_MS)
      expect(first?.outputPath).toBe(path.join(root, 'dist'))
      expect(first?.contextDependencies).toContain(path.join(root, 'public'))
      expect(first?.emitted['rules.json']).toBe('{"v": 1}')

      fs.writeFileSync(path.join(root, 'public', 'rules.json'), '{"v": 2}')
      await buildWith(
        watch,
        next(),
        (result) => result.emitted['rules.json'] === '{"v": 2}'
      )

      fs.writeFileSync(path.join(root, 'public', 'added.txt'), 'added')
      await buildWith(
        watch,
        next(),
        (result) => result.emitted['added.txt'] === 'added'
      )

      fs.rmSync(path.join(root, 'public', 'added.txt'))
      const deleted = await buildWith(
        watch,
        next(),
        (result) => !('added.txt' in result.emitted)
      )
      expect(deleted.emitted['rules.json']).toBe('{"v": 2}')
    } finally {
      await watch.close()
    }
  })

  it('drops each file deleted right after the build that added it', async () => {
    const {root, watch} = session({'public/rules.json': '{"v": 1}'})

    try {
      expect(await watch.waitForBuild(1, NEXT_BUILD_MS)).toBeDefined()

      for (const round of [1, 2, 3, 4, 5]) {
        const name = `added-${round}.txt`
        const file = path.join(root, 'public', name)

        fs.writeFileSync(file, name)
        await buildWith(
          watch,
          watch.builds.length + 1,
          (result) => result.emitted[name] === name
        )

        fs.rmSync(file)
        const deleted = await buildWith(
          watch,
          watch.builds.length + 1,
          (result) => !(name in result.emitted)
        )
        expect(deleted.emitted['rules.json']).toBe('{"v": 1}')
      }
    } finally {
      await watch.close()
    }
  })

  it('waits for a missing public/ by its own path, not the project root', async () => {
    const {root, watch} = session({})

    try {
      const first = await watch.waitForBuild(1, NEXT_BUILD_MS)
      expect(first?.missingDependencies).toContain(path.join(root, 'public'))
      expect(first?.contextDependencies).not.toContain(root)
      expect(first?.contextDependencies).not.toContain(
        path.join(root, 'public')
      )
    } finally {
      await watch.close()
    }
  })
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  project
} from './helpers/private-files-project'

// Whole builds of a public/ folder that holds links: to a file and to a
// folder outside the project, to project content, and to an installed file.

const TIMEOUT = 120_000

function fixture() {
  const root = project({
    'public/plain.txt': 'plain',
    'public/keep/inner.txt': 'kept'
  })
  const holder = path.dirname(root)
  const link = (target: string, name: string) =>
    fs.symlinkSync(target, path.join(root, 'public', name))

  link(path.join(holder, 'outside.txt'), 'linked-out.txt')
  link(path.join(holder, 'outside-folder'), 'linked-out-folder')
  link(path.join(root, 'data', 'ok.json'), 'linked-in.json')
  link(path.join(root, 'a'), 'linked-in-folder')
  link(path.join(root, 'node_modules', 'pkg', 'data.json'), 'linked-pkg.json')

  return root
}

describe.skipIf(!canLink)('a link under public/', () => {
  it(
    'is copied as the place it leads to',
    async () => {
      const result = await build(fixture())

      expect(result.shipped).toEqual([
        'keep/inner.txt',
        'linked-in-folder/keep.txt',
        'linked-in.json',
        'linked-out-folder/inner.txt',
        'linked-out.txt',
        'linked-pkg.json',
        'plain.txt'
      ])

      expect(result.marked).toEqual([
        'linked-out-folder/inner.txt',
        'linked-out.txt'
      ])

      expect(result.printed).not.toContain('left out of the')
      expect(result.errors).toBe(0)
      expectNothingPrivate(result, 'printed')
    },
    TIMEOUT
  )
})

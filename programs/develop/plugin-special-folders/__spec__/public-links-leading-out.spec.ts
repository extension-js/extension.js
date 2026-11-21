import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  project
} from '../../__spec__/helpers/private-files-project'

// Whole builds of a public/ folder that holds links: to a file and to a
// folder outside the project, to project content, and to an installed file.

const TIMEOUT = 120_000

// The whole warning, as the build words it for these four links.
const LEFT_OUT = [
  'public/keep/deep-out.txt, public/linked-out-folder/, public/linked-out.txt, public/linked-pkg.json are links, and they are left out of the chrome build.',
  'Every file in the public folder ships inside the extension, where anyone who installs it can read it, so the build never copies what a link brings from outside the project or from node_modules. To ship them, copy the files into the public folder.'
].join('\n')

function fixture() {
  const root = project({
    'public/plain.txt': 'plain',
    'public/keep/inner.txt': 'kept'
  })
  const holder = path.dirname(root)
  const link = (target: string, name: string) =>
    fs.symlinkSync(target, path.join(root, 'public', name))

  link(path.join(holder, 'outside.txt'), 'linked-out.txt')
  link(path.join(holder, 'outside.txt'), 'keep/deep-out.txt')
  link(path.join(holder, 'outside-folder'), 'linked-out-folder')
  link(path.join(root, 'data', 'ok.json'), 'linked-in.json')
  link(path.join(root, 'a'), 'linked-in-folder')
  link(path.join(root, 'node_modules', 'pkg', 'data.json'), 'linked-pkg.json')

  return root
}

describe.skipIf(!canLink)('a link under public/', () => {
  it(
    'is copied only while it leads to project content',
    async () => {
      const result = await build(fixture())

      expect(result.shipped).toEqual([
        'keep/inner.txt',
        'linked-in-folder/keep.txt',
        'linked-in.json',
        'plain.txt'
      ])

      expect(result.marked).toEqual([])
      // Whole on the human channel, and its opening again in the summary,
      // which spells each line break as JSON does.
      expect(result.printed.split(LEFT_OUT).length - 1).toBe(1)
      expect(result.printed.split(LEFT_OUT.split('\n')[0]).length - 1).toBe(2)
      expect(result.errors).toBe(0)
      expectNothingPrivate(result)
    },
    TIMEOUT
  )
})

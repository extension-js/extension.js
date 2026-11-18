import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {staleDevelopDist} from './helpers/develop-dist'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

// An engine root with a build at one time and a file written at another.
function engine(build: number, file: string, at: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dist-age-'))
  roots.push(root)

  const write = (name: string, seconds: number) => {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, 'x')
    fs.utimesSync(target, seconds, seconds)
  }

  write('types.ts', 100)
  write('dist/module.mjs', build)
  write(file, at)

  return path.join(root, 'dist', 'module.mjs')
}

describe('a built engine entry older than the sources', () => {
  it('reads as stale for a source outside the dev server folder', () => {
    expect(staleDevelopDist(engine(200, 'lib/messaging.ts', 300))).toContain(
      'older than the engine sources'
    )

    expect(staleDevelopDist(engine(200, 'types.ts', 300))).not.toBeNull()
  })

  it('reads as current when only specs, packages or the output changed', () => {
    for (const file of [
      'lib/__spec__/messaging.spec.ts',
      'node_modules/pkg/index.js',
      '.turbo/log.json',
      'dist/other.mjs',
      'lib/notes.md'
    ]) {
      expect(staleDevelopDist(engine(200, file, 300))).toBeNull()
    }
  })
})

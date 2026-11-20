import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {missingConstantsOf} from '../../feature-scripts/steps/warn-missing-build-constants'
import {classicConcatEntry} from '../../shared/classic-concat'
import {readProjectSource} from '../steps/apply-dev-defaults-lib/emitted-evidence'
import {sourceFileOf} from '../steps/warn-webassembly'

// One compile reads a project file from disk once. A scan that reads it
// again sees a later save, and the findings of one build then disagree.

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-source-read-once-'))
  )
  roots.push(root)

  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), text)
  }

  return root
}

describe('scans of one compile share the text first read from disk', () => {
  it('names the file that spelled a remote binary when the compile read it', () => {
    const root = project({'loader.js': 'load("https://cdn.example/a.wasm")\n'})
    const resource = path.join(root, 'loader.js')
    const compilation = {modules: [{resource}]}

    readProjectSource(resource, compilation)
    fs.writeFileSync(resource, 'load("./a.wasm")\n')

    expect(
      sourceFileOf(compilation as never, 'https://cdn.example/a.wasm', root)
    ).toBe('loader.js')

    expect(
      sourceFileOf(
        {modules: [{resource}]} as never,
        'https://cdn.example/a.wasm',
        root
      )
    ).toBeUndefined()
  })

  it('judges a concatenated worker by the files as the compile read them', () => {
    const root = project({
      'first.js': 'var API_BASE = "https://api.example"\n',
      'second.js': 'fetch(API_BASE)\n'
    })
    const first = path.join(root, 'first.js')
    const second = path.join(root, 'second.js')
    const compile = {}
    const modules = [
      {
        resource: classicConcatEntry('background/scripts', [first, second]),
        originalSource: () => ({source: () => 'fetch(API_BASE)\n'})
      }
    ]

    readProjectSource(first, compile)
    readProjectSource(second, compile)
    fs.writeFileSync(first, '// saved again, the constant is gone\n')

    expect(missingConstantsOf(modules as never, () => false, compile)).toEqual(
      []
    )

    expect(
      missingConstantsOf(modules as never, () => false, {}).map(
        (read) => read.name
      )
    ).toEqual(['API_BASE'])
  })
})

import {describe, it, expect, vi} from 'vitest'
import * as path from 'path'
import {AddDependencies} from '../steps/add-dependencies'

describe('AddDependencies', () => {
  it('adds existing files to compilation.fileDependencies idempotently', () => {
    const file = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      '..',
      'examples',
      'content',
      'manifest.json'
    )
    const fs = require('fs') as typeof import('fs')
    vi.spyOn(fs, 'existsSync').mockImplementation((p: string) => p === file)

    const compilation: any = {
      errors: [],
      fileDependencies: new Set<string>([])
    }

    const compiler: any = {
      hooks: {
        afterCompile: {tap: (_: string, cb: Function) => cb(compilation)}
      }
    }

    const plugin = new AddDependencies([file])
    plugin.apply(compiler)
    plugin.apply(compiler) // apply twice to ensure no duplicates added

    // afterCompile tap runs synchronously in our fake hooks, ensure it added
    expect(compilation.fileDependencies.has(file)).toBe(true)
  })
})

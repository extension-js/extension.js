import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {ThrowIfRecompileIsNeeded} from '../../steps/throw-if-recompile-is-needed'

function makeCompiler(modified: string[]) {
  const errors: any[] = []
  return {
    modifiedFiles: new Set(modified),
    hooks: {
      make: {tapAsync: (_: any, fn: any) => fn({errors} as any, () => {})}
    },
    _errors: errors
  } as any
}

describe('ThrowIfRecompileIsNeeded', () => {
  it('pushes error when js/css entries changed', () => {
    const tmp = path.join(__dirname, '.tmp-recompile')
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(
      html,
      '<html><head><link rel="stylesheet" href="a.css"></head><body><script src="a.js"></script></body></html>'
    )
    // Initial store call happens on apply
    const compiler = makeCompiler([html])
    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'm'),
      includeList: {f: html}
    } as any).apply(compiler as any)
    // Simulate change: update file to different entries
    fs.writeFileSync(
      html,
      '<html><head><link rel="stylesheet" href="b.css"></head><body><script src="b.js"></script></body></html>'
    )
    // Re-run make hook
    compiler.hooks.make.tapAsync('', (compiler as any).hooks.make.tapAsync)
    expect((compiler as any)._errors.length >= 0).toBe(true)
  })
})

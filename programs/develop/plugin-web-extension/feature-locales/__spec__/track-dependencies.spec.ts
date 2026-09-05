import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {trackLocaleDependencies} from '../track-dependencies'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-locales-track-'))
  dirs.push(root)
  fs.mkdirSync(path.join(root, '_locales', 'en'), {recursive: true})
  fs.writeFileSync(
    path.join(root, '_locales', 'en', 'messages.json'),
    '{"name": {"message": "x"}}'
  )
  fs.writeFileSync(path.join(root, 'manifest.json'), '{"default_locale":"en"}')
  return root
}

describe('trackLocaleDependencies', () => {
  it('keeps tracking locale files when the compilation already has errors', () => {
    const root = project()
    const compilation: any = {
      errors: [new Error('broken messages.json')],
      fileDependencies: new Set<string>(),
      missingDependencies: new Set<string>()
    }
    trackLocaleDependencies(compilation, path.join(root, 'manifest.json'), root)
    expect(
      compilation.fileDependencies.has(
        path.join(root, '_locales', 'en', 'messages.json')
      )
    ).toBe(true)
  })
})

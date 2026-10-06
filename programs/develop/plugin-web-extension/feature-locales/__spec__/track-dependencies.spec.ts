import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {trackLocaleDependencies} from '../track-dependencies'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
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

  it('tracks every file the locales copy emits, not only the JSON ones', () => {
    const root = project()
    const notes = path.join(root, '_locales', 'en', 'notes.txt')
    const icon = path.join(root, '_locales', 'en', 'img', 'flag.svg')
    fs.writeFileSync(notes, 'locale notes')
    fs.mkdirSync(path.dirname(icon), {recursive: true})
    fs.writeFileSync(icon, '<svg/>')

    const compilation: any = {
      errors: [],
      fileDependencies: new Set<string>(),
      missingDependencies: new Set<string>()
    }
    trackLocaleDependencies(compilation, path.join(root, 'manifest.json'), root)

    expect(compilation.fileDependencies.has(notes)).toBe(true)
    expect(compilation.fileDependencies.has(icon)).toBe(true)
  })
})

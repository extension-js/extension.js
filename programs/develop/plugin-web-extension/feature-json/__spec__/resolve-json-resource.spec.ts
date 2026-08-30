import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {resolveJsonResource} from '../resolve-json-resource'

const tempDirs: string[] = []

afterEach(() => {
  let dir = tempDirs.pop()
  while (dir) {
    fs.rmSync(dir, {recursive: true, force: true})
    dir = tempDirs.pop()
  }
})

function createProject(files: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-json-resolve-'))
  tempDirs.push(dir)
  for (const file of files) {
    const abs = path.join(dir, file)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, '[]')
  }
  return dir
}

describe('resolveJsonResource', () => {
  it('resolves a public/ relative path as under public', () => {
    const root = createProject(['public/rules.json'])
    const resolved = resolveJsonResource('public/rules.json', root, root)

    expect(resolved.abs).toBe(path.join(root, 'public', 'rules.json'))
    expect(resolved.isUnderPublic).toBe(true)
    expect(resolved.isPublicRoot).toBe(false)
  })

  it('resolves a leading-slash ref that public/ owns', () => {
    const root = createProject(['public/rules.json'])
    const resolved = resolveJsonResource('/rules.json', root, root)

    expect(resolved.abs).toBe(path.join(root, 'public', 'rules.json'))
    expect(resolved.isUnderPublic).toBe(true)
    expect(resolved.isPublicRoot).toBe(true)
  })

  it('resolves a nested leading-slash ref that public/ owns', () => {
    const root = createProject(['public/dnr/block.json'])
    const resolved = resolveJsonResource('/dnr/block.json', root, root)

    expect(resolved.abs).toBe(path.join(root, 'public', 'dnr', 'block.json'))
    expect(resolved.isUnderPublic).toBe(true)
  })

  it('resolves the includeList project-root form of a leading-slash public ref', () => {
    const root = createProject(['public/dnr/block.json'])
    const resolved = resolveJsonResource(
      path.join(root, 'dnr', 'block.json'),
      root,
      root
    )

    expect(resolved.abs).toBe(path.join(root, 'public', 'dnr', 'block.json'))
    expect(resolved.isUnderPublic).toBe(true)
  })

  it('keeps an in-project JSON file outside public/', () => {
    const root = createProject(['src/rules.json'])
    const resolved = resolveJsonResource('src/rules.json', root, root)

    expect(resolved.abs).toBe(path.join(root, 'src', 'rules.json'))
    expect(resolved.isUnderPublic).toBe(false)
    expect(resolved.isPublicRoot).toBe(false)
  })
})

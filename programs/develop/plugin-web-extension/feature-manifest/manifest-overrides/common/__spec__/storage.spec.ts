import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {storage} from '../storage'

const tempDirs: string[] = []

afterEach(() => {
  let dir = tempDirs.pop()
  while (dir) {
    fs.rmSync(dir, {recursive: true, force: true})
    dir = tempDirs.pop()
  }
})

function createProject(files: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-storage-json-'))
  tempDirs.push(dir)
  for (const file of files) {
    const abs = path.join(dir, file)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, '{"type":"object"}')
  }
  return path.join(dir, 'manifest.json')
}

describe('storage (managed_schema override)', () => {
  it('rewrites in-project schema paths to the canonical output path', () => {
    const result = storage({
      storage: {managed_schema: 'src/schema.json'}
    } as any)

    expect(result).toEqual({
      storage: {managed_schema: 'storage/managed_schema.json'}
    })
  })

  it('keeps public/ schema paths at the output root', () => {
    const result = storage({
      storage: {managed_schema: 'public/schema.json'}
    } as any)

    expect(result).toEqual({
      storage: {managed_schema: 'schema.json'}
    })
  })

  it('keeps a leading-slash schema that public/ owns at the output root', () => {
    const manifestPath = createProject(['public/schema.json'])
    const result = storage(
      {storage: {managed_schema: '/schema.json'}} as any,
      manifestPath
    )

    expect(result).toEqual({
      storage: {managed_schema: 'schema.json'}
    })
  })

  it('rewrites a leading-slash schema at the project root to the canonical path', () => {
    const manifestPath = createProject(['schema.json'])
    const result = storage(
      {storage: {managed_schema: '/schema.json'}} as any,
      manifestPath
    )

    expect(result).toEqual({
      storage: {managed_schema: 'storage/managed_schema.json'}
    })
  })

  it('returns undefined when manifest has no storage', () => {
    expect(storage({} as any)).toBeUndefined()
  })
})

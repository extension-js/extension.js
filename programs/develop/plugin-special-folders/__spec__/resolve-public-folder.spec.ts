import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  inspectPublicFolders,
  publicFolderOrDefault,
  publicResolveRoots,
  resolvePublicFolder
} from '../resolve-public-folder'

const created: string[] = []

function project(layout: {rootPublic?: boolean; srcPublic?: boolean}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-public-place-'))
  )
  created.push(root)
  fs.mkdirSync(path.join(root, 'src'), {recursive: true})
  fs.writeFileSync(path.join(root, 'src', 'manifest.json'), '{}')
  if (layout.rootPublic) fs.mkdirSync(path.join(root, 'public'))
  if (layout.srcPublic) fs.mkdirSync(path.join(root, 'src', 'public'))
  return {root, manifest: path.join(root, 'src', 'manifest.json')}
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('inspectPublicFolders', () => {
  it('keeps the project-root folder as the answer', () => {
    const {root, manifest} = project({rootPublic: true})
    const inspection = inspectPublicFolders(manifest, root)
    expect(inspection.publicDir).toBe(path.join(root, 'public'))
    expect(inspection.usedFallback).toBe(false)
    expect(inspection.bothExist).toBe(false)
  })

  it('accepts the folder beside the manifest when the root has none', () => {
    const {root, manifest} = project({srcPublic: true})
    const inspection = inspectPublicFolders(manifest, root)
    expect(inspection.publicDir).toBe(path.join(root, 'src', 'public'))
    expect(inspection.usedFallback).toBe(true)
  })

  it('lets the root win when both exist and says so', () => {
    const {root, manifest} = project({rootPublic: true, srcPublic: true})
    const inspection = inspectPublicFolders(manifest, root)
    expect(inspection.publicDir).toBe(path.join(root, 'public'))
    expect(inspection.bothExist).toBe(true)
    expect(inspection.usedFallback).toBe(false)
  })

  it('answers nothing when neither folder exists', () => {
    const {root, manifest} = project({})
    expect(resolvePublicFolder(manifest, root)).toBeUndefined()
    expect(publicFolderOrDefault(manifest, root)).toBe(
      path.join(root, 'public')
    )
  })

  it('treats a manifest at the root as one location', () => {
    const {root} = project({rootPublic: true})
    const manifest = path.join(root, 'manifest.json')
    fs.writeFileSync(manifest, '{}')
    const inspection = inspectPublicFolders(manifest, root)
    expect(inspection.publicDir).toBe(path.join(root, 'public'))
    expect(inspection.bothExist).toBe(false)
    expect(inspection.usedFallback).toBe(false)
  })
})

describe('publicResolveRoots', () => {
  it('keeps the historical order and appends the manifest-side folder', () => {
    const {root, manifest} = project({})
    expect(publicResolveRoots(root, manifest)).toEqual([
      path.join(root, 'public'),
      path.join(root, 'src'),
      path.join(root, 'src', 'public')
    ])
  })

  it('does not repeat the folder when the manifest sits at the root', () => {
    const {root} = project({})
    const manifest = path.join(root, 'manifest.json')
    expect(publicResolveRoots(root, manifest)).toEqual([
      path.join(root, 'public'),
      root
    ])
  })
})

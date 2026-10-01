import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {rememberSpecialFoldersConfig} from '../../plugin-special-folders/folders-config'
import {publicFolderOrDefault} from '../../plugin-special-folders/resolve-public-folder'
import type {SpecialFoldersConfig} from '../../types'

const created: string[] = []

function project(folders?: SpecialFoldersConfig) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-public-off-'))
  )
  created.push(root)
  fs.mkdirSync(path.join(root, 'public'))
  fs.writeFileSync(path.join(root, 'public', 'logo.png'), 'png')
  fs.writeFileSync(path.join(root, 'manifest.json'), '{}')
  rememberSpecialFoldersConfig(root, folders)

  return {root, manifest: path.join(root, 'manifest.json')}
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rememberSpecialFoldersConfig(root, undefined)
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('the folder the dev server serves and watches', () => {
  it('is none at all when the public folder is off', () => {
    const {root, manifest} = project({public: false})

    expect(publicFolderOrDefault(manifest, root)).toBeUndefined()
  })

  it('is the configured one even before it exists', () => {
    const {root, manifest} = project({public: 'assets'})

    expect(publicFolderOrDefault(manifest, root)).toBe(
      path.join(root, 'assets')
    )
  })

  it('is the root default when nothing is configured', () => {
    const {root, manifest} = project()

    expect(publicFolderOrDefault(manifest, root)).toBe(
      path.join(root, 'public')
    )
  })
})

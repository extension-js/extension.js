import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {resolveProjectStructureSync} from '../project'

const makeTempFolder = trackTempFolders()

const MANIFEST = JSON.stringify({
  manifest_version: 3,
  name: 'Probe',
  version: '1.0.0'
})

function refusalOf(projectPath: string) {
  try {
    resolveProjectStructureSync(projectPath, {quiet: true})
  } catch (error) {
    return error as Error & {code?: string}
  }

  return undefined
}

// The walk takes files only, so a folder under the name used to send the
// project to a parent's package.json while the bundler opened the folder.
describe('a package.json that is not a file', () => {
  it('refuses a folder named package.json beside the manifest, saying what it found', () => {
    const dir = makeTempFolder('extjs-pkgjson-folder-')

    fs.writeFileSync(path.join(dir, 'manifest.json'), MANIFEST)
    fs.mkdirSync(path.join(dir, 'package.json'))

    const refusal = refusalOf(dir)

    expect(refusal?.code).toBe('E_PACKAGE_JSON_INVALID')
    expect(refusal?.message).toContain('package.json is a folder, not a file.')
    expect(refusal?.message).toContain(path.join(dir, 'package.json'))
  })

  it('refuses it before the walk reaches a package.json above', () => {
    const parent = makeTempFolder('extjs-pkgjson-parent-')
    const dir = path.join(parent, 'extension')

    fs.writeFileSync(path.join(parent, 'package.json'), '{"name":"parent"}')
    fs.mkdirSync(path.join(dir, 'package.json'), {recursive: true})
    fs.writeFileSync(path.join(dir, 'manifest.json'), MANIFEST)

    expect(refusalOf(dir)?.code).toBe('E_PACKAGE_JSON_INVALID')
  })

  it('refuses it at the named folder when the manifest sits in src', () => {
    const dir = makeTempFolder('extjs-pkgjson-src-')

    fs.mkdirSync(path.join(dir, 'src'))
    fs.writeFileSync(path.join(dir, 'src', 'manifest.json'), MANIFEST)
    fs.mkdirSync(path.join(dir, 'package.json'))

    expect(refusalOf(dir)?.code).toBe('E_PACKAGE_JSON_INVALID')
  })
})

describe('a project with no package.json at all', () => {
  it('resolves to the manifest alone, with no project root named', () => {
    const dir = makeTempFolder('extjs-pkgjson-none-')

    fs.writeFileSync(path.join(dir, 'manifest.json'), MANIFEST)

    expect(resolveProjectStructureSync(dir, {quiet: true})).toEqual({
      manifestPath: path.join(dir, 'manifest.json')
    })
  })

  it('still walks to the package.json of the project above it', () => {
    const parent = makeTempFolder('extjs-pkgjson-above-')
    const dir = path.join(parent, 'extension')

    fs.writeFileSync(path.join(parent, 'package.json'), '{"name":"parent"}')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'manifest.json'), MANIFEST)

    expect(resolveProjectStructureSync(parent, {quiet: true})).toEqual({
      manifestPath: path.join(dir, 'manifest.json'),
      packageJsonPath: path.join(parent, 'package.json')
    })
  })
})

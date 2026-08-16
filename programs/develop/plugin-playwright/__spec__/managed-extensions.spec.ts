import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {chromiumExtensionIdFromPath} from '../../lib/extension-id'
import {createPlaywrightMetadataWriter} from '../index'

describe('ready.json records the extensions the engine loads on its own behalf', () => {
  let tmp: string
  let companionDir: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-extensions-'))
    companionDir = path.join(tmp, 'companion')
    fs.mkdirSync(companionDir)
    fs.writeFileSync(
      path.join(companionDir, 'manifest.json'),
      JSON.stringify({name: 'companion', version: '1'})
    )
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (managedExtensionDirs?: string[]) =>
    createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'dev',
      distPath: path.join(tmp, 'dist', 'chromium'),
      manifestPath: path.join(tmp, 'src', 'manifest.json'),
      managedExtensionDirs
    })

  it('stamps managedExtensions with resolved path and id', () => {
    const writer = makeWriter([companionDir])
    writer.writeStarting()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(ready.managedExtensions).toEqual([
      {
        path: path.resolve(companionDir),
        id: chromiumExtensionIdFromPath(companionDir)
      }
    ])
  })

  it('keeps managedExtensions across every status transition', () => {
    const writer = makeWriter([companionDir])
    writer.writeStarting()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(ready.status).toBe('ready')
    expect(ready.managedExtensions).toHaveLength(1)
  })

  it('preserves managedExtensions written by another writer', () => {
    const writer = makeWriter([companionDir])
    writer.writeReady()

    const unaware = makeWriter()
    unaware.writeReady()

    const ready = JSON.parse(fs.readFileSync(unaware.readyPath, 'utf-8'))
    expect(ready.managedExtensions).toEqual([
      {
        path: path.resolve(companionDir),
        id: chromiumExtensionIdFromPath(companionDir)
      }
    ])
  })

  it('accepts dirs set after creation', () => {
    const writer = makeWriter()
    writer.setManagedExtensionDirs([companionDir])
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(ready.managedExtensions).toHaveLength(1)
    expect(ready.managedExtensions[0].id).toBe(
      chromiumExtensionIdFromPath(companionDir)
    )
  })

  it('omits the field when the engine loads nothing of its own', () => {
    const writer = makeWriter([])
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(ready.managedExtensions).toBeUndefined()
  })

  it('an explicit empty list clears companions another writer left behind', () => {
    const writer = makeWriter([companionDir])
    writer.writeReady()
    expect(
      JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8')).managedExtensions
    ).toHaveLength(1)

    const clearer = makeWriter([])
    clearer.writeReady()

    const ready = JSON.parse(fs.readFileSync(clearer.readyPath, 'utf-8'))
    expect(ready.managedExtensions).toBeUndefined()
  })

  it('setManagedExtensionDirs([]) clears and a later unaware write stays clear', () => {
    const writer = makeWriter([companionDir])
    writer.writeReady()
    writer.setManagedExtensionDirs([])
    writer.writeReady()

    expect(
      JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8')).managedExtensions
    ).toBeUndefined()

    const unaware = makeWriter()
    unaware.writeReady()
    expect(
      JSON.parse(fs.readFileSync(unaware.readyPath, 'utf-8')).managedExtensions
    ).toBeUndefined()
  })
})

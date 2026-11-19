import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {chromiumExtensionIdFromPath} from '../../lib/extension-id'
import {
  makeWriter as makeProjectWriter,
  readContract,
  writeManifest
} from './helpers/contract'

describe('ready.json records the extensions the engine loads on its own behalf', () => {
  let tmp: string
  let companionDir: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-extensions-'))
    companionDir = path.join(tmp, 'companion')
    writeManifest(companionDir, {name: 'companion', version: '1'})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (managedExtensionDirs?: string[]) =>
    makeProjectWriter(tmp, {managedExtensionDirs})

  const companionRecord = () => ({
    path: path.resolve(companionDir),
    id: chromiumExtensionIdFromPath(companionDir)
  })

  it('stamps managedExtensions with resolved path and id', () => {
    const writer = makeWriter([companionDir])
    writer.writeStarting()

    expect(readContract(writer.readyPath).managedExtensions).toEqual([
      companionRecord()
    ])
  })

  it('keeps managedExtensions across every status transition', () => {
    const writer = makeWriter([companionDir])
    writer.writeStarting()
    writer.writeReady()

    const ready = readContract(writer.readyPath)
    expect(ready.status).toBe('ready')
    expect(ready.managedExtensions).toHaveLength(1)
  })

  it('preserves managedExtensions written by another writer', () => {
    const writer = makeWriter([companionDir])
    writer.writeReady()

    const unaware = makeWriter()
    unaware.writeReady()

    expect(readContract(unaware.readyPath).managedExtensions).toEqual([
      companionRecord()
    ])
  })

  it('accepts dirs set after creation', () => {
    const writer = makeWriter()
    writer.setManagedExtensionDirs([companionDir])
    writer.writeReady()

    expect(readContract(writer.readyPath).managedExtensions).toEqual([
      companionRecord()
    ])
  })

  it('omits the field when the engine loads nothing of its own', () => {
    const writer = makeWriter([])
    writer.writeReady()

    expect(readContract(writer.readyPath).managedExtensions).toBeUndefined()
  })

  it('an explicit empty list clears companions another writer left behind', () => {
    const writer = makeWriter([companionDir])
    writer.writeReady()
    expect(readContract(writer.readyPath).managedExtensions).toHaveLength(1)

    const clearer = makeWriter([])
    clearer.writeReady()

    expect(readContract(clearer.readyPath).managedExtensions).toBeUndefined()
  })

  it('setManagedExtensionDirs([]) clears and a later unaware write stays clear', () => {
    const writer = makeWriter([companionDir])
    writer.writeReady()
    writer.setManagedExtensionDirs([])
    writer.writeReady()

    expect(readContract(writer.readyPath).managedExtensions).toBeUndefined()

    const unaware = makeWriter()
    unaware.writeReady()
    expect(readContract(unaware.readyPath).managedExtensions).toBeUndefined()
  })
})

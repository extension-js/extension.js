import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import type {Manifest} from '../../types'
import {getBackgroundEntryName} from '../steps/setup-reload-strategy'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function makeProject(files: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-bg-entry-'))
  tempDirs.push(dir)
  for (const file of files) {
    const filePath = path.join(dir, file)
    fs.mkdirSync(path.dirname(filePath), {recursive: true})
    fs.writeFileSync(filePath, '// stub', 'utf8')
  }
  return dir
}

// The name handed to the fork's ServiceWorkerPlugin must match an entry
// AddScripts will create, because the plugin asserts at entryOption that the
// entry exists and a wrong name hard-crashes the whole build.
describe('getBackgroundEntryName', () => {
  it('names the declared service worker when its file exists', () => {
    const manifestDir = makeProject(['background/index.js'])
    const manifest: Manifest = {
      manifest_version: 3,
      background: {service_worker: 'background/index.js'}
    }

    expect(getBackgroundEntryName(manifest, 'chrome', {manifestDir})).toEqual({
      serviceWorkerEntry: 'background/service_worker',
      tryCatchWrapper: true,
      eagerChunkLoading: false
    })
  })

  it('names background/scripts for a Firefox-style MV3 manifest on chromium', () => {
    const manifestDir = makeProject(['background.js'])
    const manifest = {
      manifest_version: 3,
      background: {scripts: ['background.js']}
    } as Manifest

    expect(getBackgroundEntryName(manifest, 'chrome', {manifestDir})).toEqual({
      serviceWorkerEntry: 'background/scripts',
      tryCatchWrapper: true,
      eagerChunkLoading: false
    })
  })

  it('prefers the declared service worker over background.scripts', () => {
    const manifestDir = makeProject(['sw.js', 'background.js'])
    const manifest = {
      manifest_version: 3,
      background: {service_worker: 'sw.js', scripts: ['background.js']}
    } as Manifest

    const result = getBackgroundEntryName(manifest, 'chrome', {manifestDir})
    expect(result.serviceWorkerEntry).toBe('background/service_worker')
  })

  it('omits the worker entry when the service worker file is missing', () => {
    const manifestDir = makeProject()
    const manifest: Manifest = {
      manifest_version: 3,
      background: {service_worker: 'background/missing.js'}
    }

    expect(getBackgroundEntryName(manifest, 'chrome', {manifestDir})).toEqual({
      tryCatchWrapper: true,
      eagerChunkLoading: false
    })
  })

  it('omits the worker entry when no background.scripts file exists', () => {
    const manifestDir = makeProject()
    const manifest = {
      manifest_version: 3,
      background: {scripts: ['background/missing.js']}
    } as Manifest

    const result = getBackgroundEntryName(manifest, 'chrome', {manifestDir})
    expect(result.serviceWorkerEntry).toBeUndefined()
    expect(result.pageEntry).toBeUndefined()
  })

  it('keeps the gecko page entry regardless of files on disk', () => {
    const manifestDir = makeProject()
    const manifest = {
      manifest_version: 3,
      background: {scripts: ['background/missing.js']}
    } as Manifest

    const result = getBackgroundEntryName(manifest, 'firefox', {manifestDir})
    expect(result.pageEntry).toBe('background/script')
    expect(result.serviceWorkerEntry).toBeUndefined()
  })

  it('keeps the MV2 page entry untouched', () => {
    const manifestDir = makeProject(['background.js'])
    const manifest = {
      manifest_version: 2,
      background: {scripts: ['background.js']}
    } as Manifest

    const result = getBackgroundEntryName(manifest, 'chrome', {manifestDir})
    expect(result.pageEntry).toBe('background/script')
    expect(result.serviceWorkerEntry).toBeUndefined()
  })

  it('falls back to the plain background page entry with no background key', () => {
    const manifestDir = makeProject()
    const manifest: Manifest = {manifest_version: 3}

    const result = getBackgroundEntryName(manifest, 'chrome', {manifestDir})
    expect(result.pageEntry).toBe('background')
    expect(result.serviceWorkerEntry).toBeUndefined()
  })
})

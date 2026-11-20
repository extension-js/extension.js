import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import type {Manifest} from '../../../types'
import {getBackgroundEntryName} from '../background-entry-name'

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

// The name must match an entry AddScripts will create, because the chunk
// loader puts the background side of its message fallback in that entry.
describe('getBackgroundEntryName', () => {
  it('names the declared service worker when its file exists', () => {
    const manifestDir = makeProject(['background/index.js'])
    const manifest = {
      manifest_version: 3,
      background: {service_worker: 'background/index.js'}
    } as Manifest

    expect(getBackgroundEntryName(manifest, 'chrome', {manifestDir})).toEqual({
      serviceWorkerEntry: 'background/service_worker'
    })
  })

  // A leading slash names the extension root, which is the manifest folder
  // in source space, as the manifest fields read it for the entry itself.
  it.each([
    ['service_worker', {service_worker: '/background/index.js'}],
    ['scripts', {scripts: ['/background/index.js']}]
  ])('names the worker entry for a root-relative background.%s', (key, background) => {
    const projectPath = makeProject(['src/background/index.js'])
    const manifestDir = path.join(projectPath, 'src')
    const manifest = {manifest_version: 3, background} as Manifest

    expect(
      getBackgroundEntryName(manifest, 'chrome', {manifestDir, projectPath})
    ).toEqual({
      serviceWorkerEntry:
        key === 'scripts' ? 'background/scripts' : 'background/service_worker'
    })
  })

  it('names background/scripts for a Firefox-style MV3 manifest on chromium', () => {
    const manifestDir = makeProject(['background.js'])
    const manifest = {
      manifest_version: 3,
      background: {scripts: ['background.js']}
    } as Manifest

    expect(getBackgroundEntryName(manifest, 'chrome', {manifestDir})).toEqual({
      serviceWorkerEntry: 'background/scripts'
    })
  })

  it('prefers the declared service worker over background.scripts', () => {
    const manifestDir = makeProject(['sw.js', 'background.js'])
    const manifest = {
      manifest_version: 3,
      background: {service_worker: 'sw.js', scripts: ['background.js']}
    } as unknown as Manifest

    const result = getBackgroundEntryName(manifest, 'chrome', {manifestDir})
    expect(result.serviceWorkerEntry).toBe('background/service_worker')
  })

  it('omits the worker entry when the service worker file is missing', () => {
    const manifestDir = makeProject()
    const manifest = {
      manifest_version: 3,
      background: {service_worker: 'background/missing.js'}
    } as Manifest

    expect(getBackgroundEntryName(manifest, 'chrome', {manifestDir})).toEqual(
      {}
    )
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

  // Every background.scripts file is bundled into background/scripts, and
  // Gecko runs that bundle as a page whatever the manifest version.
  it('names background/scripts as a page entry on gecko', () => {
    const manifestDir = makeProject(['background.js'])
    const manifest = {
      manifest_version: 3,
      background: {scripts: ['background.js']}
    } as Manifest

    expect(getBackgroundEntryName(manifest, 'firefox', {manifestDir})).toEqual({
      pageEntry: 'background/scripts'
    })
  })

  it('keeps the gecko page entry regardless of files on disk', () => {
    const manifestDir = makeProject()
    const manifest = {
      manifest_version: 3,
      background: {scripts: ['background/missing.js']}
    } as Manifest

    expect(getBackgroundEntryName(manifest, 'firefox', {manifestDir})).toEqual({
      pageEntry: 'background/scripts'
    })
  })

  it('names background/scripts as a page entry for MV2', () => {
    const manifestDir = makeProject(['background.js'])
    const manifest = {
      manifest_version: 2,
      background: {scripts: ['background.js']}
    } as Manifest

    expect(getBackgroundEntryName(manifest, 'chrome', {manifestDir})).toEqual({
      pageEntry: 'background/scripts'
    })
  })

  // No background.scripts means no background/scripts entry, so nothing is
  // named and a dev session answers from the entry it generates.
  it('names no entry on gecko for a background with no scripts', () => {
    const manifestDir = makeProject(['background.js'])
    const manifest = {
      manifest_version: 3,
      background: {service_worker: 'background.js'}
    } as Manifest

    expect(getBackgroundEntryName(manifest, 'firefox', {manifestDir})).toEqual(
      {}
    )
  })

  it('names no entry for MV2 with an empty background', () => {
    const manifestDir = makeProject()
    const manifest = {manifest_version: 2, background: {}} as Manifest

    expect(getBackgroundEntryName(manifest, 'chrome', {manifestDir})).toEqual(
      {}
    )
  })

  it('names no entry with no background key', () => {
    const manifestDir = makeProject()
    const manifest = {manifest_version: 3} as Manifest

    expect(getBackgroundEntryName(manifest, 'chrome', {manifestDir})).toEqual(
      {}
    )
  })

  it('names the compiled background page entry for an MV2 background.page', () => {
    const manifestDir = makeProject(['background.html'])
    const manifest = {
      manifest_version: 2,
      background: {page: 'background.html'}
    } as Manifest

    const result = getBackgroundEntryName(manifest, 'chrome', {manifestDir})
    expect(result.pageEntry).toBe('background/index')
    expect(result.serviceWorkerEntry).toBeUndefined()
  })

  it('names the compiled background page entry on gecko too', () => {
    const manifestDir = makeProject(['background.html'])
    const manifest = {
      manifest_version: 2,
      background: {page: 'background.html'}
    } as Manifest

    const result = getBackgroundEntryName(manifest, 'firefox', {manifestDir})
    expect(result.pageEntry).toBe('background/index')
  })

  it('prefers a declared script over a page declared beside it', () => {
    const manifestDir = makeProject(['background.html', 'background.js'])
    const manifest = {
      manifest_version: 2,
      background: {page: 'background.html', scripts: ['background.js']}
    } as Manifest

    const result = getBackgroundEntryName(manifest, 'chrome', {manifestDir})
    expect(result.pageEntry).toBe('background/scripts')
  })
})

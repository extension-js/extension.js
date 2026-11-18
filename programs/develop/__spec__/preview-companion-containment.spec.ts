import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {extensionPreview} from '../command-preview'
import {trackTempFolders} from './helpers/temp-folders'

// A companion folder the user names may sit anywhere inside the project
// root. One that resolves outside it is refused, browser or not.
const tempFolder = trackTempFolders()

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const MANIFEST = JSON.stringify({
  manifest_version: 3,
  name: 'containment',
  version: '1.0.0'
})

function extensionAt(folder: string): string {
  fs.mkdirSync(folder, {recursive: true})
  fs.writeFileSync(path.join(folder, 'manifest.json'), MANIFEST)

  return folder
}

// The project sits one level down, so `..` stays inside this spec's folder.
function builtProject(): {root: string; outside: string} {
  const base = fs.realpathSync.native(tempFolder('extjs-companion-contain-'))
  const root = path.join(base, 'project')

  extensionAt(root)
  extensionAt(path.join(root, 'dist', 'chromium'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'containment', version: '0.0.0'})
  )

  return {root, outside: extensionAt(path.join(base, 'outside-ext'))}
}

function preview(root: string, entry: string) {
  return extensionPreview(root, {
    browser: 'chromium',
    noBrowser: true,
    extensions: [entry]
  } as never)
}

function refusal(folder: string) {
  return {
    code: 'E_COMPANION_EXTENSION_PATH',
    message: `Companion extensions must be inside the project.\nPATH ${folder}`
  }
}

describe('preview --no-browser and where a named companion sits', () => {
  it('takes a folder at the project root', async () => {
    const {root} = builtProject()

    extensionAt(path.join(root, 'my-ext'))

    expect((await preview(root, 'my-ext'))?.warnings).toEqual([])
  })

  it('takes a folder under extensions', async () => {
    const {root} = builtProject()

    extensionAt(path.join(root, 'extensions', 'my-ext'))

    expect((await preview(root, 'extensions/my-ext'))?.warnings).toEqual([])
  })

  it('refuses a relative path that leaves the project', async () => {
    const {root, outside} = builtProject()

    await expect(preview(root, '../outside-ext')).rejects.toMatchObject(
      refusal(outside)
    )
  })

  it('refuses an absolute path outside the project', async () => {
    const {root, outside} = builtProject()

    await expect(preview(root, outside)).rejects.toMatchObject(refusal(outside))
  })

  it('refuses a link inside the project that leads outside it', async () => {
    const {root, outside} = builtProject()
    const link = path.join(root, 'extensions', 'linked')

    fs.mkdirSync(path.dirname(link), {recursive: true})
    fs.symlinkSync(outside, link, 'junction')

    await expect(preview(root, './extensions/linked')).rejects.toMatchObject(
      refusal(link)
    )
  })

  it('takes a link inside the project that stays inside it', async () => {
    const {root} = builtProject()
    const target = extensionAt(path.join(root, 'vendor', 'real-ext'))
    const link = path.join(root, 'extensions', 'linked')

    fs.mkdirSync(path.dirname(link), {recursive: true})
    fs.symlinkSync(target, link, 'junction')

    expect((await preview(root, './extensions/linked'))?.warnings).toEqual([])
  })
})

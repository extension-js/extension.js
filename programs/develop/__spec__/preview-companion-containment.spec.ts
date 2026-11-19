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
    message: `Companion extensions must be inside the project.\nInvalid path: ${folder}`
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

  it('takes a folder under node_modules that the user named', async () => {
    const {root} = builtProject()

    extensionAt(path.join(root, 'node_modules', 'some-ext'))

    expect((await preview(root, 'node_modules/some-ext'))?.warnings).toEqual([])
  })

  it('refuses the project itself', async () => {
    const {root} = builtProject()

    await expect(preview(root, './')).rejects.toMatchObject(refusal(root))
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

function previewWith(root: string, extensions: unknown) {
  return extensionPreview(root, {
    browser: 'chromium',
    noBrowser: true,
    extensions
  } as never)
}

describe('preview --no-browser and where extensions.dir sits', () => {
  function dirRefusal(folder: string) {
    return {
      code: 'E_COMPANION_EXTENSION_PATH',
      message: `extensions.dir must be inside the project.\nInvalid dir: ${folder}`
    }
  }

  it('scans a folder inside the project', async () => {
    const {root} = builtProject()

    extensionAt(path.join(root, 'vendor', 'companions', 'one'))

    expect(
      (await previewWith(root, {dir: './vendor/companions'}))?.warnings
    ).toEqual([])
  })

  for (const dir of ['.', './']) {
    it(`refuses the project itself, written as ${dir}`, async () => {
      const {root} = builtProject()

      await expect(previewWith(root, {dir})).rejects.toMatchObject(
        dirRefusal(root)
      )
    })
  }

  it.skipIf(process.platform === 'win32')(
    'refuses a link whose real path is the project',
    async () => {
      const {root} = builtProject()
      const link = path.join(root, 'loop')

      fs.symlinkSync(root, link)

      await expect(previewWith(root, {dir: './loop'})).rejects.toMatchObject(
        dirRefusal(link)
      )
    }
  )

  it('refuses a folder outside the project', async () => {
    const {root, outside} = builtProject()

    await expect(
      previewWith(root, {dir: '../outside-ext'})
    ).rejects.toMatchObject(dirRefusal(outside))
  })

  it('refuses a link inside the project that leads outside it', async () => {
    const {root, outside} = builtProject()
    const link = path.join(root, 'companions')

    fs.symlinkSync(outside, link, 'junction')

    await expect(
      previewWith(root, {dir: './companions'})
    ).rejects.toMatchObject(dirRefusal(link))
  })
})

describe('preview --no-browser and an entry that is neither link nor folder', () => {
  it('refuses a bare name that is not on disk', async () => {
    const {root} = builtProject()

    await expect(preview(root, 'my-ext')).rejects.toMatchObject({
      code: 'E_COMPANION_EXTENSION_PATH',
      message:
        'Companion extension entry is neither a store link nor a folder path: my-ext\n' +
        'Give a store link or the path of a folder inside the project'
    })
  })

  it('refuses a store id given without its store link', async () => {
    const {root} = builtProject()
    const id = 'abcdefghijklmnopabcdefghijklmnop'

    await expect(preview(root, id)).rejects.toMatchObject({
      code: 'E_COMPANION_EXTENSION_PATH',
      message:
        `Companion extension entry looks like a store id, not a store link: ${id}\n` +
        'Use the full store link so the browser it belongs to is known, ' +
        `for example https://chromewebstore.google.com/detail/<name>/${id}`
    })
  })

  it('passes a store link without fetching it', async () => {
    const {root} = builtProject()

    expect(
      (
        await preview(
          root,
          'https://chromewebstore.google.com/detail/some-name/abcdefghijklmnopabcdefghijklmnop'
        )
      )?.warnings
    ).toEqual([])
  })
})

describe('preview --no-browser and a link the scan meets', () => {
  function scannedOut(entry: string, leadsTo: string) {
    return (
      'W_COMPANION_EXTENSION_PATH: A companion extension entry leads outside the project, so it is not loaded.\n' +
      `ENTRY ${entry}\n` +
      `LEADS TO ${leadsTo}\n` +
      'Companion extensions must be inside the project. Copy the folder into the project, or remove the link.'
    )
  }

  it.skipIf(process.platform === 'win32')(
    'warns once about a link under extensions that leads outside',
    async () => {
      const {root, outside} = builtProject()

      extensionAt(path.join(root, 'extensions', 'real'))
      fs.symlinkSync(outside, path.join(root, 'extensions', 'linked-out'))
      fs.symlinkSync(
        extensionAt(path.join(root, 'vendor', 'inside')),
        path.join(root, 'extensions', 'linked-in')
      )

      const result = await extensionPreview(root, {
        browser: 'chromium',
        noBrowser: true
      } as never)

      expect(result?.warnings).toEqual([
        scannedOut('./extensions/linked-out', outside)
      ])

      expect(
        vi
          .mocked(console.warn)
          .mock.calls.map((call) => String(call[0]))
          .filter((line) => line.includes('leads outside the project'))
      ).toHaveLength(1)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'names a link met in a declared dir and in a grouping folder below it',
    async () => {
      const {root, outside} = builtProject()

      fs.mkdirSync(path.join(root, 'vendor', 'companions', 'chromium'), {
        recursive: true
      })

      fs.symlinkSync(
        outside,
        path.join(root, 'vendor', 'companions', 'chromium', 'linked-out')
      )

      expect(
        (await previewWith(root, {dir: 'vendor/companions/'}))?.warnings
      ).toEqual([scannedOut('vendor/companions/chromium/linked-out', outside)])
    }
  )

  it.skipIf(process.platform === 'win32')(
    'stays quiet about a scanned link that stays inside the project',
    async () => {
      const {root} = builtProject()

      fs.mkdirSync(path.join(root, 'extensions'))
      fs.symlinkSync(
        extensionAt(path.join(root, 'vendor', 'inside')),
        path.join(root, 'extensions', 'linked-in')
      )

      expect(
        (
          await extensionPreview(root, {
            browser: 'chromium',
            noBrowser: true
          } as never)
        )?.warnings
      ).toEqual([])
    }
  )
})

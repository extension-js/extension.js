import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

function project(manifestText: string, files: Record<string, string> = {}) {
  const root = tempFolder('extjs-comments-')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'comments', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'manifest.json'), manifestText)
  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("up")')

  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true})
    fs.writeFileSync(path.join(root, file), text)
  }

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const printed: string[] = []

  const record = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation(record)
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(record)
  let failure: unknown

  try {
    await buildProject(root, {
      browser,
      silent: false,
      mode: 'production',
      exitOnError: false
    })
  } catch (error) {
    failure = error
  } finally {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  }

  const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')
  const refusal = failure as {code?: string; message?: string} | undefined
  const builtPath = path.join(root, 'dist', browser, 'manifest.json')

  return {
    code: refusal?.code,
    refusalMessage: plain(String(refusal?.message || '')),
    rendered: plain(printed.join('\n')),
    built: fs.existsSync(builtPath) ? fs.readFileSync(builtPath, 'utf-8') : ''
  }
}

const manifest = (extra = '') => `{
  "manifest_version": 3,
  "name": "Manifest with comments",
  "version": "1.0.0",${extra}
  "background": {
    "service_worker": "background.js",
    "scripts": ["background.js"]
  }
}
`

const REMOVED = 'Removed the comments from the built manifest.json'

describe('manifest.json with comments (real build)', () => {
  for (const browser of ['chrome', 'firefox'] as const) {
    it(`builds a manifest with // comments for ${browser} and emits plain JSON`, async () => {
      const root = project(
        manifest('\n  // Both engines load a manifest that carries this.')
      )
      const {code, built, rendered} = await build(root, browser)

      expect(code).toBeUndefined()
      expect(built).not.toContain('//')
      expect(JSON.parse(built).name).toBe('Manifest with comments')
      expect(rendered.split(REMOVED)).toHaveLength(2)
      expect(rendered).toContain('the stores refuse a manifest that has them')
    })

    it(`builds a manifest with a byte order mark for ${browser}`, async () => {
      const {code, built} = await build(project(`﻿${manifest()}`), browser)

      expect(code).toBeUndefined()
      expect(JSON.parse(built).version).toBe('1.0.0')
    })

    it(`refuses a trailing comma for ${browser}, as the browser does`, async () => {
      const root = project(manifest().replace(/\}\n\}\n$/, '},\n}\n'))
      const {code, refusalMessage} = await build(root, browser)

      expect(code).toBe('E_MANIFEST_INVALID')
      expect(refusalMessage).toContain("Couldn't parse manifest.json as JSON.")
      expect(refusalMessage).toContain(
        'unexpected character at line 9 column 1'
      )
    })

    it(`says nothing about comments for ${browser} when the manifest has none`, async () => {
      const {code, rendered} = await build(project(manifest()), browser)

      expect(code).toBeUndefined()
      expect(rendered).not.toContain(REMOVED)
    })
  }

  it('builds a /* */ block comment for chrome and emits plain JSON', async () => {
    const root = project(manifest('\n  /* Chromium reads this one. */'))
    const {code, built, rendered} = await build(root, 'chrome')

    expect(code).toBeUndefined()
    expect(built).not.toContain('/*')
    expect(rendered).toContain(REMOVED)
  })

  it('refuses a /* */ block comment for firefox and names its place', async () => {
    const root = project(manifest('\n  /* Chromium reads this one. */'))
    const {code, refusalMessage, built} = await build(root, 'firefox')

    expect(code).toBe('E_MANIFEST_INVALID')
    expect(refusalMessage).toContain(
      'Firefox does not read a /* */ block comment, found at line 5 column 3'
    )

    expect(built).toBe('')
  })

  it('points a real syntax error at the file as written, comments included', async () => {
    const root = project(
      '{\n  // a comment first\n  "manifest_version": 3, /* and a block */\n  "name": "x"\n  "version": "1.0.0"\n}\n'
    )
    const {code, refusalMessage} = await build(root, 'chrome')

    expect(code).toBe('E_MANIFEST_INVALID')
    expect(refusalMessage).toContain("Couldn't parse manifest.json as JSON.")
    expect(refusalMessage).toContain('unexpected character at line 5 column 3')
  })

  // Node's parse message quotes the start of the file, which a manifest
  // linked to another file would relay.
  it('names the place a manifest stops parsing and quotes none of it', async () => {
    const secret = 'root:x:0:0:secret-hunter2'
    const {code, refusalMessage, rendered} = await build(
      project(secret),
      'chrome'
    )

    expect(code).toBe('E_MANIFEST_INVALID')
    expect(refusalMessage).toContain('unexpected character at line 1 column 1')

    for (let i = 0; i + 4 <= secret.length; i++) {
      expect(refusalMessage + rendered).not.toContain(secret.slice(i, i + 4))
    }
  })

  it('ships a commented locale catalog as plain JSON', async () => {
    const root = project(
      manifest('\n  "default_locale": "en",').replace(
        '"Manifest with comments"',
        '"__MSG_name__"'
      ),
      {
        '_locales/en/messages.json':
          '{\n  // the visible name\n  "name": {"message": "Localized"}\n}\n'
      }
    )
    const {code} = await build(root, 'firefox')
    const catalog = fs.readFileSync(
      path.join(root, 'dist', 'firefox', '_locales', 'en', 'messages.json'),
      'utf-8'
    )

    expect(code).toBeUndefined()
    expect(catalog).not.toContain('//')
    expect(JSON.parse(catalog)).toEqual({name: {message: 'Localized'}})
  })
})

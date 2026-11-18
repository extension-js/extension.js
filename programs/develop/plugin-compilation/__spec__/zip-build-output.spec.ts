import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {strFromU8, unzipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {ZipPlugin} from '../zip'

function readZip(zipPath: string): Record<string, string> {
  const unzipped = unzipSync(new Uint8Array(fs.readFileSync(zipPath)))

  return Object.fromEntries(
    Object.entries(unzipped).map(([name, bytes]) => [name, strFromU8(bytes)])
  )
}

function makeCompiler(ctx: string, outPath: string) {
  let doneCb: any
  const compiler: any = {
    options: {context: ctx, output: {path: outPath}},
    hooks: {
      done: {
        tapPromise: (_name: string, cb: any) => {
          doneCb = cb
        }
      }
    }
  }

  return {
    compiler,
    emitDone: async (stats: any = {compilation: {warnings: []}}) => {
      await doneCb(stats)

      return stats
    }
  }
}

function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, contents)
}

// Plain text stand-ins for what a dev session leaves in its session folder.
function writeSessionFolder(sessionRoot: string, marker: string) {
  write(path.join(sessionRoot, '.gitignore'), '*\n')
  write(path.join(sessionRoot, 'chrome', 'ready.json'), `${marker}-READY`)
  write(path.join(sessionRoot, 'chrome', 'events.ndjson'), `${marker}-EVENTS`)
  write(path.join(sessionRoot, 'chrome', 'control-token'), `${marker}-TOKEN`)
  write(
    path.join(sessionRoot, 'profiles', 'chrome-profile', 'dev', 'Cookies'),
    `${marker}-PROFILE`
  )
}

const BUILT_MANIFEST = JSON.stringify({name: 'Packed', version: '1.0.0'})

function writeProject(root: string) {
  write(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'Packed', version: '1.0.0', manifest_version: 3})
  )

  write(path.join(root, 'src', 'background.ts'), 'export const a = 1')
}

async function zipProject(
  root: string,
  outPath: string,
  zipData: {zip?: boolean; zipSource?: boolean}
) {
  const {compiler, emitDone} = makeCompiler(root, outPath)
  new ZipPlugin({
    browser: 'chrome',
    zipData,
    manifestPath: path.join(root, 'manifest.json')
  }).apply(compiler)

  const stats = await emitDone()
  const warnings: string[] = stats.compilation.warnings.map((w: Error) =>
    String(w.message)
  )

  return {warnings}
}

describe('the source zip and a build folder that is not the top-level dist', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-build-output-'))
    writeProject(root)
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  // Pins today's behavior: a build run from src leaves src/dist behind.
  it('packs a nested dist and the session folder inside it', async () => {
    const outPath = path.join(root, 'dist', 'chrome')
    write(path.join(outPath, 'manifest.json'), BUILT_MANIFEST)
    writeSessionFolder(path.join(root, 'dist', 'extension-js'), 'TOP')
    write(path.join(root, 'src', 'dist', 'chrome', 'manifest.json'), 'OLD')
    writeSessionFolder(path.join(root, 'src', 'dist', 'extension-js'), 'NESTED')

    await zipProject(root, outPath, {zipSource: true})

    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-source.zip'))

    expect(Object.keys(packed).sort()).toEqual([
      'manifest.json',
      'src/background.ts',
      'src/dist/chrome/manifest.json',
      'src/dist/extension-js/.gitignore',
      'src/dist/extension-js/chrome/control-token',
      'src/dist/extension-js/chrome/events.ndjson',
      'src/dist/extension-js/chrome/ready.json',
      'src/dist/extension-js/profiles/chrome-profile/dev/Cookies'
    ])

    expect(packed['src/dist/extension-js/chrome/ready.json']).toBe(
      'NESTED-READY'
    )

    expect(
      packed['src/dist/extension-js/profiles/chrome-profile/dev/Cookies']
    ).toBe('NESTED-PROFILE')
  })

  // Pins today's behavior for a session folder with no dist above it.
  it('packs a session folder that sits outside any dist', async () => {
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    writeSessionFolder(path.join(root, 'tools', 'extension-js'), 'LOOSE')

    await zipProject(root, outPath, {zipSource: true})

    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-source.zip'))

    expect(packed['tools/extension-js/chrome/ready.json']).toBe('LOOSE-READY')
    expect(
      packed['tools/extension-js/profiles/chrome-profile/dev/Cookies']
    ).toBe('LOOSE-PROFILE')
  })

  // Pins today's behavior under a custom output folder such as build/chrome.
  it('packs the session folder beside a custom output folder', async () => {
    const outPath = path.join(root, 'build', 'chrome')
    write(path.join(outPath, 'manifest.json'), BUILT_MANIFEST)
    writeSessionFolder(path.join(root, 'build', 'extension-js'), 'CUSTOM')

    await zipProject(root, outPath, {zipSource: true})

    const packed = readZip(path.join(root, 'build', 'packed-1.0.0-source.zip'))

    expect(packed['build/extension-js/chrome/ready.json']).toBe('CUSTOM-READY')
    expect(packed['build/chrome/manifest.json']).toBeUndefined()
  })

  it('keeps a source folder named dist that holds no session folder', async () => {
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    write(path.join(root, 'vendor', 'lib', 'dist', 'lib.min.js'), 'LIB')

    await zipProject(root, outPath, {zipSource: true})

    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-source.zip'))

    expect(packed['vendor/lib/dist/lib.min.js']).toBe('LIB')
  })
})

describe('the extension zip and the session folder', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-build-output-'))
    writeProject(root)
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  it.each([
    'dist',
    'build'
  ])('holds only the output when the session folder sits beside %s/chrome', async (base) => {
    const outPath = path.join(root, base, 'chrome')
    write(path.join(outPath, 'manifest.json'), BUILT_MANIFEST)

    write(path.join(outPath, 'background.js'), 'BUILT')
    writeSessionFolder(path.join(root, base, 'extension-js'), 'BESIDE')

    await zipProject(root, outPath, {zip: true})

    const packed = readZip(path.join(root, base, 'packed-1.0.0-chrome.zip'))

    expect(Object.keys(packed).sort()).toEqual([
      'background.js',
      'manifest.json'
    ])
  })

  // Pins today's behavior when a config points the output at dist itself.
  it('packs a session folder that sits inside the output folder', async () => {
    const outPath = path.join(root, 'dist')
    write(path.join(outPath, 'manifest.json'), BUILT_MANIFEST)

    write(path.join(outPath, 'background.js'), 'BUILT')
    writeSessionFolder(path.join(outPath, 'extension-js'), 'INSIDE')

    await zipProject(root, outPath, {zip: true})

    const packed = readZip(path.join(root, 'packed-1.0.0-chrome.zip'))

    expect(packed['extension-js/chrome/ready.json']).toBe('INSIDE-READY')
    expect(packed['extension-js/profiles/chrome-profile/dev/Cookies']).toBe(
      'INSIDE-PROFILE'
    )
  })
})

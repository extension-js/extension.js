import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {strFromU8, unzipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {findSessionFolders, ZipPlugin} from '../zip'

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

  // A build run from src leaves src/dist behind, session folder included.
  it('leaves out a nested dist that holds a session folder', async () => {
    const outPath = path.join(root, 'dist', 'chrome')
    write(path.join(outPath, 'manifest.json'), BUILT_MANIFEST)
    writeSessionFolder(path.join(root, 'dist', 'extension-js'), 'TOP')
    write(path.join(root, 'src', 'dist', 'chrome', 'manifest.json'), 'OLD')
    writeSessionFolder(path.join(root, 'src', 'dist', 'extension-js'), 'NESTED')

    const {warnings} = await zipProject(root, outPath, {zipSource: true})
    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-source.zip'))

    expect(Object.keys(packed).sort()).toEqual([
      'manifest.json',
      'src/background.ts'
    ])

    expect(Object.values(packed).join('\n')).not.toMatch(/NESTED|TOP|OLD/)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/The source zip left out a folder/)
    expect(warnings[0]).toMatch(/LEFT OUT\S* src\/dist\n/)
  })

  it('leaves out a session folder that sits outside any dist', async () => {
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    writeSessionFolder(path.join(root, 'tools', 'extension-js'), 'LOOSE')
    write(path.join(root, 'tools', 'release.mjs'), 'SCRIPT')

    const {warnings} = await zipProject(root, outPath, {zipSource: true})
    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-source.zip'))

    expect(Object.keys(packed).sort()).toEqual([
      'manifest.json',
      'src/background.ts',
      'tools/release.mjs'
    ])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/LEFT OUT\S* tools\/extension-js\n/)
  })

  // The folder beside the current output is expected, so nothing is said.
  it('leaves out the session folder beside a custom output folder', async () => {
    const outPath = path.join(root, 'build', 'chrome')
    write(path.join(outPath, 'manifest.json'), BUILT_MANIFEST)
    writeSessionFolder(path.join(root, 'build', 'extension-js'), 'CUSTOM')

    const {warnings} = await zipProject(root, outPath, {zipSource: true})
    const packed = readZip(path.join(root, 'build', 'packed-1.0.0-source.zip'))

    expect(Object.keys(packed).sort()).toEqual([
      'manifest.json',
      'src/background.ts'
    ])

    expect(warnings).toEqual([])
  })

  // A vendored library ships its own dist, and a reviewer needs it to build.
  it('keeps a source folder named dist that holds no session folder', async () => {
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    write(path.join(root, 'vendor', 'lib', 'dist', 'lib.min.js'), 'LIB')

    const {warnings} = await zipProject(root, outPath, {zipSource: true})
    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-source.zip'))

    expect(packed['vendor/lib/dist/lib.min.js']).toBe('LIB')
    expect(warnings).toEqual([])
  })

  it('keeps a package named extension-js and leaves out the dist it built', async () => {
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    const pkg = path.join(root, 'packages', 'extension-js')
    write(path.join(pkg, 'package.json'), '{"name":"mine"}')
    write(path.join(pkg, 'src', 'index.ts'), 'export const b = 2')
    write(path.join(pkg, 'dist', 'chrome', 'manifest.json'), 'OLD')
    writeSessionFolder(path.join(pkg, 'dist', 'extension-js'), 'PKG')

    const {warnings} = await zipProject(root, outPath, {zipSource: true})
    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-source.zip'))

    expect(Object.keys(packed).sort()).toEqual([
      'manifest.json',
      'packages/extension-js/package.json',
      'packages/extension-js/src/index.ts',
      'src/background.ts'
    ])

    expect(warnings[0]).toMatch(/LEFT OUT\S* packages\/extension-js\/dist\n/)
  })

  // The name alone is enough to leave a folder out, and the warning says so.
  it('leaves out a folder named extension-js that holds no package.json', async () => {
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    write(path.join(root, 'docs', 'extension-js', 'notes.md'), 'NOTES')

    const {warnings} = await zipProject(root, outPath, {zipSource: true})
    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-source.zip'))

    expect(packed['docs/extension-js/notes.md']).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/LEFT OUT\S* docs\/extension-js\n/)
    expect(warnings[0]).toMatch(/packed once it holds a package\.json/)
  })

  it('says nothing about a nested dist the root .gitignore already covers', async () => {
    const outPath = path.join(root, 'dist', 'chrome')
    fs.mkdirSync(outPath, {recursive: true})
    write(path.join(root, '.gitignore'), 'dist\n')
    writeSessionFolder(path.join(root, 'src', 'dist', 'extension-js'), 'NESTED')

    const {warnings} = await zipProject(root, outPath, {zipSource: true})
    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-source.zip'))

    expect(Object.keys(packed).sort()).toEqual([
      '.gitignore',
      'manifest.json',
      'src/background.ts'
    ])

    expect(warnings).toEqual([])
  })
})

describe('findSessionFolders', () => {
  const session = [
    'src/dist/chrome/manifest.json',
    'src/dist/extension-js/chrome/ready.json',
    'tools/extension-js/profiles/chrome-profile/dev/Cookies',
    'packages/extension-js/package.json',
    'packages/extension-js/src/index.ts',
    'src/extension-js.ts'
  ]

  it('names the same folders whichever separator the listing uses', () => {
    const windows = session.map((file) => file.replace(/\//g, '\\'))

    expect(findSessionFolders(session, 'source')).toEqual([
      'src/dist',
      'tools/extension-js'
    ])

    expect(findSessionFolders(windows, 'source')).toEqual([
      'src/dist',
      'tools/extension-js'
    ])
  })

  it('takes a dist that holds the folder whole, a package.json inside or not', () => {
    expect(
      findSessionFolders(
        ['a/dist/extension-js/package.json', 'a/dist/index.js'],
        'source'
      )
    ).toEqual(['a/dist'])
  })

  it('takes a package of its own once it holds session files', () => {
    expect(
      findSessionFolders(
        ['extension-js/package.json', 'extension-js/firefox/events.ndjson'],
        'source'
      )
    ).toEqual(['extension-js'])
  })

  it('names an outer folder once when a session folder sits inside another', () => {
    expect(
      findSessionFolders(
        ['extension-js/profiles/p/extension-js/chrome/ready.json'],
        'source'
      )
    ).toEqual(['extension-js'])
  })

  it('needs session files in build output, where the name alone is an asset', () => {
    expect(findSessionFolders(['extension-js/logo.png'], 'output')).toEqual([])
    expect(
      findSessionFolders(
        ['extension-js\\logo.png', 'extension-js\\chrome\\ready.json'],
        'output'
      )
    ).toEqual(['extension-js'])
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

    const {warnings} = await zipProject(root, outPath, {zip: true})
    const packed = readZip(path.join(root, base, 'packed-1.0.0-chrome.zip'))

    expect(Object.keys(packed).sort()).toEqual([
      'background.js',
      'manifest.json'
    ])

    expect(warnings).toEqual([])
  })

  // A config that points the output at dist itself puts the folder inside.
  it('leaves out a session folder that sits inside the output folder', async () => {
    const outPath = path.join(root, 'dist')
    write(path.join(outPath, 'manifest.json'), BUILT_MANIFEST)
    write(path.join(outPath, 'background.js'), 'BUILT')
    writeSessionFolder(path.join(outPath, 'extension-js'), 'INSIDE')

    const {warnings} = await zipProject(root, outPath, {zip: true})
    const packed = readZip(path.join(root, 'packed-1.0.0-chrome.zip'))

    expect(Object.keys(packed).sort()).toEqual([
      'background.js',
      'manifest.json'
    ])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/The extension zip left out a folder/)
    expect(warnings[0]).toMatch(/LEFT OUT\S* extension-js\n/)
    expect(warnings[0]).not.toMatch(/package\.json/)
  })

  it('keeps an asset folder of the extension that is named extension-js', async () => {
    const outPath = path.join(root, 'dist', 'chrome')
    write(path.join(outPath, 'manifest.json'), BUILT_MANIFEST)
    write(path.join(outPath, 'extension-js', 'logo.svg'), 'LOGO')

    const {warnings} = await zipProject(root, outPath, {zip: true})
    const packed = readZip(path.join(root, 'dist', 'packed-1.0.0-chrome.zip'))

    expect(packed['extension-js/logo.svg']).toBe('LOGO')
    expect(warnings).toEqual([])
  })
})

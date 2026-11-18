import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  errorsOf,
  openDevWatchSession
} from './helpers/dev-watch-session'

// A url() or a bare require() with no target is left verbatim and warned.
// Writing the target is the fix asked for, so a running session picks it up.
let root = ''
let session: DevWatchSession

// Above the inline limit, so the url() is a file and not a data URL.
const image = (fill: number) =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(4096, fill)
  ])

const write = (name: string, contents: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
  fs.writeFileSync(path.join(root, name), contents)
}

const warningsOf = (stats: {compilation: {warnings?: unknown[]}}) =>
  Array.from(stats.compilation.warnings || []).map((warning) =>
    String((warning as Error)?.message || warning)
  )

function distFiles(): string[] {
  return fs
    .readdirSync(session.distPath, {recursive: true, withFileTypes: true})
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}

function distText(pattern: RegExp): string {
  return distFiles()
    .filter((file) => pattern.test(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
}

beforeAll(async () => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-missing-reference-'))
  )

  write(
    'package.json',
    JSON.stringify({
      private: true,
      name: 'missing-reference',
      version: '0.0.0',
      dependencies: {'watched-dep': '1.0.0'}
    })
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'missing-reference',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      action: {default_popup: 'popup/index.html'}
    })
  )

  write(
    'background.js',
    "const later = require('later-pkg')\nconsole.log('BACKGROUND_MARK', later)\n"
  )

  write(
    'popup/index.html',
    '<!doctype html><link rel="stylesheet" href="./styles.css" /><p>popup</p>'
  )

  // The name is served from public/, so it is not a dead reference, and no
  // file by that name sits beside the sheet for the bundler to take.
  write('popup/styles.css', 'body { background: url(later.png); }\n')
  write('public/later.png', image(1))
  write('public/never.png', image(2))

  // A package the session transpiles keeps node_modules watched, which is
  // the one layout where an install can reach a running session.
  write(
    'node_modules/watched-dep/package.json',
    JSON.stringify({name: 'watched-dep', version: '1.0.0', main: 'index.js'})
  )

  write('node_modules/watched-dep/index.js', 'module.exports = 1\n')

  session = await openDevWatchSession(root, 'chrome', undefined, {
    transpilePackages: ['watched-dep']
  })
}, 120000)

afterAll(async () => {
  await session?.close()
  if (root) fs.rmSync(root, {recursive: true, force: true})
})

describe('a missing reference that appears during a dev session', () => {
  it('starts with both references left verbatim', async () => {
    await session.settle()

    expect(distText(/\.css$/)).toContain('url("later.png")')
    expect(distText(/service_worker\.js$/)).toMatch(
      /require\(["']later-pkg["']\)/
    )
  })

  it('rebuilds the stylesheet once the file its url() names is written', async () => {
    const seen = await session.settle()

    write('popup/later.png', image(3))

    const stats = await session.doneAfter(seen, 15000)

    expect(errorsOf(stats)).toEqual([])
    expect(warningsOf(stats).join('\n')).not.toContain('later.png')
    // The sheet now names the file the bundler emitted for it.
    expect(distText(/\.css$/)).not.toContain('url("later.png")')
    expect(distText(/\.css$/)).toMatch(/url\("\/assets\/later[^"]*\.png"\)/)
  }, 60000)

  it('rebuilds the script once the package its require() names is installed', async () => {
    const seen = await session.settle()

    write(
      'node_modules/later-pkg/package.json',
      JSON.stringify({name: 'later-pkg', version: '1.0.0', main: 'index.js'})
    )

    write('node_modules/later-pkg/index.js', "module.exports = 'LATER_MARK'\n")

    const stats = await session.doneAfter(seen, 15000)

    expect(errorsOf(stats)).toEqual([])
    expect(warningsOf(stats).join('\n')).not.toContain('later-pkg')

    const worker = distText(/service_worker\.js$/)

    expect(worker).toContain('LATER_MARK')
    expect(worker).not.toMatch(/require\(["']later-pkg["']\)/)
  }, 60000)

  it('stops watching for a reference its file no longer makes', async () => {
    const seen = await session.settle()

    write('popup/styles.css', 'body { background: url(never.png); }\n')

    const withReference = await session.doneAfter(seen, 15000)

    expect(warningsOf(withReference).join('\n')).toContain('never.png')

    const afterReference = await session.settle()

    write('popup/styles.css', 'body { background: none; }\n')
    await session.doneAfter(afterReference, 15000)

    const quiet = await session.settle()

    write('popup/never.png', image(4))

    // The file is under no folder the session watches for its own sake.
    expect(await session.quietFor(1500)).toBe(quiet)
  }, 90000)
})

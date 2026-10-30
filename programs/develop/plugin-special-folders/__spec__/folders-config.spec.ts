import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {isDevOnlyEntry, omitDevOnlyEntries} from '../folders-config'
import {
  getSpecialFoldersDataForCompiler,
  getSpecialFoldersDataForProjectRoot,
  rememberSpecialFoldersConfig
} from '../get-data'
import {
  inspectPublicFolders,
  publicResolveRoots
} from '../resolve-public-folder'

const created: string[] = []

function project(files: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-folders-config-'))
  )
  created.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'folders', private: true})
  )

  fs.writeFileSync(path.join(root, 'manifest.json'), '{"manifest_version":3}')

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rememberSpecialFoldersConfig(dir, undefined)
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

const keys = (list: Record<string, unknown> | undefined) =>
  Object.keys(list || {}).sort()

describe('the folders config', () => {
  it('turns a special folder off with false', () => {
    const root = project({
      'scripts/helper.js': 'console.log("helper")',
      'pages/extra.html': '<html></html>',
      'src/a.js':
        'chrome.scripting.executeScript({files: ["scripts/helper.js"]})'
    })

    expect(keys(getSpecialFoldersDataForProjectRoot(root).scripts)).toEqual([
      'scripts/helper'
    ])

    expect(
      keys(getSpecialFoldersDataForProjectRoot(root, {scripts: false}).scripts)
    ).toEqual([])

    expect(
      keys(getSpecialFoldersDataForProjectRoot(root, {pages: false}).pages)
    ).toEqual([])
  })

  it('reads a folder that moved under src/', () => {
    const root = project({
      'src/scripts/injected.js': 'console.log("injected")',
      'src/a.js':
        'chrome.scripting.executeScript({files: ["scripts/injected.js"]})'
    })

    expect(keys(getSpecialFoldersDataForProjectRoot(root).scripts)).toEqual([])
    const moved = getSpecialFoldersDataForProjectRoot(root, {
      scripts: 'src/scripts'
    })
    expect(keys(moved.scripts)).toEqual(['scripts/injected'])
    expect(String(moved.scripts?.['scripts/injected'])).toContain(
      path.join('src', 'scripts', 'injected.js')
    )
  })

  it('lets a compiler find the config the command resolved', () => {
    const root = project({
      'scripts/helper.js': 'console.log("helper")',
      'src/a.js':
        'chrome.scripting.executeScript({files: ["scripts/helper.js"]})'
    })
    const compiler = {options: {context: root}} as never

    expect(keys(getSpecialFoldersDataForCompiler(compiler).scripts)).toEqual([
      'scripts/helper'
    ])

    rememberSpecialFoldersConfig(root, {scripts: false})

    expect(keys(getSpecialFoldersDataForCompiler(compiler).scripts)).toEqual([])
  })
})

describe('the public folder setting', () => {
  it('reads public from the configured path only', () => {
    const root = project({
      'public/old.txt': 'old',
      'src/assets/new.txt': 'new'
    })
    const manifestPath = path.join(root, 'manifest.json')

    expect(inspectPublicFolders(manifestPath, root).publicDir).toBe(
      path.join(root, 'public')
    )

    rememberSpecialFoldersConfig(root, {public: 'src/assets'})

    expect(inspectPublicFolders(manifestPath, root).publicDir).toBe(
      path.join(root, 'src', 'assets')
    )

    expect(publicResolveRoots(root, manifestPath)).toEqual([
      path.join(root, 'src', 'assets'),
      root
    ])
  })

  it('reads no public folder when it is off', () => {
    const root = project({'public/old.txt': 'old'})
    const manifestPath = path.join(root, 'manifest.json')

    rememberSpecialFoldersConfig(root, {public: false})

    expect(inspectPublicFolders(manifestPath, root).publicDir).toBeUndefined()
    expect(publicResolveRoots(root, manifestPath)).toEqual([root])
  })
})

describe('development-only entries', () => {
  it('recognizes a .dev. file by its name alone', () => {
    expect(isDevOnlyEntry('pages/player.dev.html')).toBe(true)
    expect(isDevOnlyEntry('/abs/scripts/bench.dev.ts')).toBe(true)
    expect(isDevOnlyEntry('pages/nested/parity.DEV.html')).toBe(true)
    expect(isDevOnlyEntry('pages/player.html')).toBe(false)
    expect(isDevOnlyEntry('pages/dev/player.html')).toBe(false)
    expect(isDevOnlyEntry('scripts/devtools.js')).toBe(false)
    expect(isDevOnlyEntry('scripts/player.dev.module.css')).toBe(false)
  })

  it('drops the dev-only files from a list and names them', () => {
    const dropped: string[] = []
    const next = omitDevOnlyEntries(
      {
        'pages/player': '/p/pages/player.dev.html',
        'pages/engine': '/p/pages/engine.html',
        'scripts/pair': ['/p/scripts/a.js', '/p/scripts/b.dev.js']
      },
      dropped
    )

    expect(next).toEqual({
      'pages/engine': '/p/pages/engine.html',
      'scripts/pair': ['/p/scripts/a.js']
    })

    expect(dropped).toEqual(['/p/pages/player.dev.html', '/p/scripts/b.dev.js'])
  })

  it('leaves them out of a production scan only', () => {
    const root = project({
      'pages/engine.html': '<html></html>',
      'pages/player.dev.html': '<html></html>',
      'pages/bench/parity.dev.html': '<html></html>',
      'scripts/content.js': 'document.title = "c"',
      'scripts/bench.dev.js': 'document.title = "b"'
    })

    const production = getSpecialFoldersDataForProjectRoot(
      root,
      undefined,
      'production'
    )
    expect(keys(production.pages)).toEqual(['pages/engine'])
    expect(keys(production.scripts)).toEqual(['scripts/content'])

    const development = getSpecialFoldersDataForProjectRoot(
      root,
      undefined,
      'development'
    )
    expect(keys(development.pages)).toEqual([
      'pages/bench/parity.dev',
      'pages/engine',
      'pages/player.dev'
    ])

    expect(keys(development.scripts)).toEqual([
      'scripts/bench.dev',
      'scripts/content'
    ])

    // No mode given, nothing is left out: a caller that only reads the
    // companion extensions list has no mode to give.
    expect(keys(getSpecialFoldersDataForProjectRoot(root).pages)).toEqual(
      keys(development.pages)
    )

    const compiler = (mode: string) => ({options: {context: root, mode}}) as any
    expect(
      keys(getSpecialFoldersDataForCompiler(compiler('production')).pages)
    ).toEqual(['pages/engine'])

    expect(
      keys(getSpecialFoldersDataForCompiler(compiler('development')).scripts)
    ).toEqual(['scripts/bench.dev', 'scripts/content'])
  })
})

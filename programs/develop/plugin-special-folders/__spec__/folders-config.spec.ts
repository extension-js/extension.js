import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
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

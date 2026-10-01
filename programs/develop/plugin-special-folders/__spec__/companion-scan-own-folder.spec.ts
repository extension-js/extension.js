import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {resolveCompanionExtensionDirs} from '../folder-extensions/resolve-dirs'
import {isDirExactCase} from '../folder-extensions/utils'

const created: string[] = []

function project(layout: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-companion-case-'))
  )
  created.push(root)

  for (const [rel, content] of Object.entries(layout)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

const manifest = JSON.stringify({manifest_version: 3, name: 'x', version: '1'})

describe('isDirExactCase', () => {
  it('accepts only a directory entry spelled exactly like the probe', () => {
    const root = project({'Extensions/combined/manifest.json': manifest})

    expect(isDirExactCase(path.join(root, 'Extensions'))).toBe(true)
    expect(isDirExactCase(path.join(root, 'extensions'))).toBe(false)
    expect(isDirExactCase(path.join(root, 'missing'))).toBe(false)
  })
})

describe('the default extensions/ scan', () => {
  it('ignores a project folder that only matches the name on a case-insensitive disk', () => {
    const root = project({'Extensions/combined/manifest.json': manifest})

    expect(
      resolveCompanionExtensionDirs({
        projectRoot: root,
        config: {dir: './extensions'},
        browser: 'firefox'
      })
    ).toEqual([])
  })

  it('never loads the folder that holds the project manifest as a companion', () => {
    const root = project({
      'extensions/combined/manifest.json': manifest,
      'extensions/helper/manifest.json': manifest
    })

    expect(
      resolveCompanionExtensionDirs({
        projectRoot: root,
        config: {dir: './extensions'},
        browser: 'chrome',
        manifestPath: path.join(root, 'extensions', 'combined', 'manifest.json')
      })
    ).toEqual([path.join(root, 'extensions', 'helper')])
  })
})

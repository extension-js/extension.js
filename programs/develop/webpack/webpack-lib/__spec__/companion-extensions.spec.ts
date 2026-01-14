import * as fs from 'fs'
import * as path from 'path'
import {afterEach, describe, expect, it} from 'vitest'
import {resolveCompanionExtensionDirs} from '../companion-extensions'

const created: string[] = []

function makeTempDir(prefix: string) {
  const base = fs.mkdtempSync(path.join(process.cwd(), prefix))
  created.push(base)
  return base
}

afterEach(() => {
  for (const p of created.splice(0)) {
    try {
      fs.rmSync(p, {recursive: true, force: true})
    } catch {
      // ignore
    }
  }
})

describe('resolveCompanionExtensionDirs', () => {
  it('returns explicit paths that contain manifest.json and ignores invalid ones', () => {
    const root = makeTempDir('extjs-companion-')
    const ok = path.join(root, 'ok-ext')
    const bad = path.join(root, 'bad-ext')
    fs.mkdirSync(ok, {recursive: true})
    fs.mkdirSync(bad, {recursive: true})
    fs.writeFileSync(path.join(ok, 'manifest.json'), '{}')
    // bad has no manifest.json

    const dirs = resolveCompanionExtensionDirs({
      projectRoot: root,
      config: ['./ok-ext', './bad-ext']
    })
    expect(dirs).toEqual([ok])
  })

  it('scans a directory one level deep and de-dupes while preserving order', () => {
    const root = makeTempDir('extjs-companion-')
    const scan = path.join(root, 'extensions')
    fs.mkdirSync(scan, {recursive: true})

    const a = path.join(scan, 'a')
    const b = path.join(scan, 'b')
    fs.mkdirSync(a, {recursive: true})
    fs.mkdirSync(b, {recursive: true})
    fs.writeFileSync(path.join(a, 'manifest.json'), '{}')
    fs.writeFileSync(path.join(b, 'manifest.json'), '{}')

    const dirs = resolveCompanionExtensionDirs({
      projectRoot: root,
      config: {
        paths: ['./extensions/a', './extensions/a'],
        dir: './extensions'
      }
    })

    // explicit path first, then scan (b should follow), a should not duplicate
    expect(dirs).toEqual([a, b])
  })
})


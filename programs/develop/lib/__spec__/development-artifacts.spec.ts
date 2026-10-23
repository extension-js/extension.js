import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {removeDevelopmentArtifacts} from '../development-artifacts'

let distPath: string

function writeTree(files: string[]) {
  for (const relative of files) {
    const target = path.join(distPath, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, relative)
  }
}

beforeEach(() => {
  distPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-artifacts-')),
    'dist',
    'chrome'
  )
})

afterEach(() => {
  fs.rmSync(path.dirname(path.dirname(distPath)), {
    recursive: true,
    force: true
  })
})

describe('removeDevelopmentArtifacts', () => {
  it('removes the control file, hot updates, stand-ins and registry', () => {
    writeTree([
      'extension-js-control.json',
      'hot/main.abc123.hot-update.js',
      'hot/runtime/main.abc123.hot-update.json',
      'content_scripts/dev-stub-0.js',
      'content_scripts/dev-stub-12.js',
      'content_scripts/dev-css-1.js',
      'content_scripts/dev-registry.json'
    ])

    const removed = removeDevelopmentArtifacts(distPath)

    expect(removed).toEqual([
      'extension-js-control.json',
      'hot',
      'content_scripts/dev-registry.json',
      'content_scripts/dev-css-1.js',
      'content_scripts/dev-stub-0.js',
      'content_scripts/dev-stub-12.js'
    ])

    expect(
      fs.existsSync(path.join(distPath, 'extension-js-control.json'))
    ).toBe(false)

    expect(fs.existsSync(path.join(distPath, 'hot'))).toBe(false)
    expect(fs.readdirSync(path.join(distPath, 'content_scripts'))).toEqual([])
  })

  it('leaves every production asset in place', () => {
    const shipped = [
      'manifest.json',
      'background/service_worker.js',
      'content_scripts/content-0.js',
      'content_scripts/content-1.a1b2c3.js',
      'content_scripts/content-0.css',
      'action/index.html',
      'hotkeys/index.js'
    ]
    writeTree([...shipped, 'extension-js-control.json', 'hot/x.js'])

    removeDevelopmentArtifacts(distPath)

    for (const relative of shipped) {
      expect(fs.readFileSync(path.join(distPath, relative), 'utf8')).toBe(
        relative
      )
    }
  })

  it('reports nothing on a dist with no development artifacts', () => {
    writeTree(['manifest.json'])

    expect(removeDevelopmentArtifacts(distPath)).toEqual([])
  })

  it('tolerates a dist that does not exist', () => {
    expect(removeDevelopmentArtifacts(path.join(distPath, 'missing'))).toEqual(
      []
    )
  })
})

import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {takeCodedWarnings} from '../../lib/coded-warnings'
import {resolveCompanionExtensionDirs} from '../folder-extensions/resolve-dirs'

// The scanned companion folder, entry by entry, where an entry is a link.

const created: string[] = []
const canLink = process.platform !== 'win32'

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }

  takeCodedWarnings()
  vi.restoreAllMocks()
})

function extensionAt(dir: string) {
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'x', version: '0.0.0'})
  )
}

// A project one folder below a holder that stands for everything outside.
function layout() {
  const holder = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-companion-links-'))
  )
  created.push(holder)

  const root = path.join(holder, 'project')

  extensionAt(path.join(root, 'extensions', 'real'))
  extensionAt(path.join(root, 'vendor', 'in'))
  extensionAt(path.join(root, 'vendor', 'set', 'grouped'))
  extensionAt(path.join(root, 'extensions', 'firefox', 'gecko-only'))
  extensionAt(path.join(holder, 'outside', 'out'))
  extensionAt(path.join(holder, 'outside', 'set', 'grouped-out'))
  fs.writeFileSync(path.join(root, 'notes.txt'), 'notes')

  return {holder, root}
}

function link(root: string, name: string, target: string) {
  fs.symlinkSync(target, path.join(root, 'extensions', name))
}

function scan(root: string, launchesBrowser = true) {
  const said: string[] = []

  vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
    said.push(parts.map(String).join(' '))
  })

  const loaded = resolveCompanionExtensionDirs({
    projectRoot: root,
    config: {dir: './extensions'},
    browser: 'chrome',
    launchesBrowser
  }).map((dir) => path.relative(root, dir).replace(/\\/g, '/'))

  return {loaded, said, coded: takeCodedWarnings()}
}

describe('an entry of the scanned companion folder', () => {
  it('loads a folder and leaves another browser its own set', () => {
    const {root} = layout()

    expect(scan(root)).toEqual({
      loaded: ['extensions/real'],
      said: [],
      coded: []
    })
  })

  it.skipIf(!canLink)('is a link to a folder inside the project', () => {
    const {root} = layout()

    link(root, 'linked-in', path.join(root, 'vendor', 'in'))
    link(root, 'linked-set', path.join(root, 'vendor', 'set'))

    // It loads like any folder, and one that groups extensions is read one
    // level down like any folder too.
    expect(scan(root)).toEqual({
      loaded: [
        'extensions/linked-in',
        'extensions/real',
        'extensions/linked-set/grouped'
      ],
      said: [],
      coded: []
    })
  })

  it.skipIf(!canLink)('is a link to a folder outside the project', () => {
    const {holder, root} = layout()

    link(root, 'linked-out', path.join(holder, 'outside', 'out'))
    link(root, 'linked-out-set', path.join(holder, 'outside', 'set'))

    const warning = (entry: string, target: string) =>
      [
        'A companion extension entry leads outside the project, so it is not loaded.',
        `ENTRY ./extensions/${entry}`,
        `LEADS TO ${path.join(holder, 'outside', target)}`,
        'Companion extensions must be inside the project. Copy the folder into the project, or remove the link.'
      ].join('\n')
    const said = [
      warning('linked-out', 'out'),
      warning('linked-out-set', 'set')
    ]

    // Each is said once and carried once under its code, the rest goes on.
    expect(scan(root)).toEqual({
      loaded: ['extensions/real'],
      said,
      coded: said.map((text) => `E_COMPANION_EXTENSION_PATH: ${text}`)
    })

    // A caller that launches no browser leaves the words to the path that
    // says them there, and loads the same set.
    expect(scan(root, false)).toEqual({
      loaded: ['extensions/real'],
      said: [],
      coded: []
    })
  })

  it.skipIf(!canLink)(
    'is a link to nothing, to a file, to itself or to a folder above it',
    () => {
      const {root} = layout()

      link(root, 'broken', path.join(root, 'vendor', 'gone'))
      link(root, 'linked-file', path.join(root, 'notes.txt'))
      link(root, 'loop', path.join(root, 'extensions', 'loop'))
      link(root, 'around', path.join(root, 'extensions'))
      link(root, 'project', root)

      // None is a folder to load, none is said, and the scan ends: a folder
      // reached twice is one extension.
      expect(scan(root)).toEqual({
        loaded: ['extensions/real'],
        said: [],
        coded: []
      })
    }
  )
})

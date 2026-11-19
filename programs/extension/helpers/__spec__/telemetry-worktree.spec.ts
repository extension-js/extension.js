import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  blockFolder,
  fsWith,
  readRows,
  useTelemetrySandbox
} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

const COMMITTED_ID = '0d66f514-e3bb-457c-a334-a194a58d0361'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function storedId(folder: string, value: string): string {
  fs.mkdirSync(folder, {recursive: true})
  const file = path.join(folder, 'anonymous-id')
  fs.writeFileSync(file, value, 'utf8')

  return file
}

describe('a committed anonymous-id never aggregates strangers', () => {
  it('adopts a stored id verbatim outside any worktree', () => {
    const box = sandbox()
    const file = storedId(box.configDir, COMMITTED_ID)

    expect(box.kit().loadOrCreateId(file)).toBe(COMMITTED_ID)
  })

  it('re-keys a stored id with a machine salt inside a worktree', () => {
    const box = sandbox()
    fs.mkdirSync(path.join(box.root, '.git'))
    const file = storedId(box.configDir, COMMITTED_ID)
    const kit = box.kit()
    const first = kit.loadOrCreateId(file)

    expect(first).not.toBe(COMMITTED_ID)
    expect(first).toMatch(UUID)
    // Stable per machine, so the counter still sees one machine as one.
    expect(kit.loadOrCreateId(file)).toBe(first)
    expect(fs.readFileSync(file, 'utf8')).toBe(COMMITTED_ID)
  })

  it('creates and keeps a new id when none is stored', () => {
    const box = sandbox()
    const file = path.join(box.configDir, 'anonymous-id')
    const kit = box.kit()
    const id = kit.loadOrCreateId(file)

    expect(id).toMatch(UUID)
    expect(fs.readFileSync(file, 'utf8')).toBe(id)
    expect(kit.loadOrCreateId(file)).toBe(id)
  })

  it('answers a fresh id every time when the id cannot be kept', () => {
    const box = sandbox()
    const file = path.join(blockFolder(path.join(box.root, 'a-file')), 'id')
    const kit = box.kit()
    const first = kit.loadOrCreateId(file)

    expect(first).toMatch(UUID)
    expect(kit.loadOrCreateId(file)).not.toBe(first)
  })

  it('answers a fresh id when the stored one cannot be read', () => {
    const box = sandbox({
      deps: {
        fs: fsWith({
          readFileSync: () => {
            throw new Error('EIO')
          }
        })
      }
    })
    const file = storedId(box.configDir, COMMITTED_ID)
    const id = box.kit().loadOrCreateId(file)

    expect(id).toMatch(UUID)
    expect(id).not.toBe(COMMITTED_ID)
  })

  it.each([
    ['empty', ''],
    ['blank', '  \n'],
    ['not a UUID', 'not-a-uuid']
  ])('replaces a stored id that is %s with a fresh one, and keeps it', (_label, stored) => {
    const box = sandbox()
    const file = storedId(box.configDir, stored)
    const kit = box.kit()
    const id = kit.loadOrCreateId(file)

    expect(id).toMatch(UUID)
    expect(fs.readFileSync(file, 'utf8')).toBe(id)
    expect(kit.loadOrCreateId(file)).toBe(id)
  })

  it('takes a stored id with a newline or capitals as it is', () => {
    const box = sandbox()
    const file = storedId(box.configDir, `${COMMITTED_ID.toUpperCase()}\n`)

    expect(box.kit().loadOrCreateId(file)).toBe(COMMITTED_ID.toUpperCase())
  })

  it('audits events under a fresh id when the stored one is empty', () => {
    const box = sandbox()

    storedId(box.configDir, '')
    box.telemetry({sampleRate: 1, debounceMs: 0}).track('command_executed', {
      command: 'test',
      success: true,
      version: '0.0.0'
    })

    const rows = readRows(path.join(box.configDir, 'events.jsonl'))

    expect(rows).toHaveLength(1)
    expect(rows[0].distinct_id).toMatch(UUID)
  })
})

describe('the worktree walk', () => {
  it('flags a nested folder under a repo root', () => {
    const box = sandbox()
    fs.mkdirSync(path.join(box.root, '.git'))

    expect(box.kit().isInsideGitWorkTree(path.join(box.root, 'a', 'b'))).toBe(
      true
    )
  })

  it('does not flag a plain folder', () => {
    const box = sandbox()

    expect(box.kit().isInsideGitWorkTree(path.join(box.root, 'a', 'b'))).toBe(
      false
    )
  })

  it('stops at the home folder, a dotfiles repo at ~ is not foreign', () => {
    const box = sandbox()
    fs.mkdirSync(path.join(box.places.home, '.git'))

    // The walk never checks ~ itself, so a dotfiles repo stays machine state.
    expect(
      box.kit().isInsideGitWorkTree(path.join(box.places.home, '.config'))
    ).toBe(false)
  })

  it('walks on to the root when the home folder cannot be read', () => {
    const box = sandbox({
      deps: {
        homedir: () => {
          throw new Error('no home')
        }
      }
    })
    fs.mkdirSync(path.join(box.places.home, '.git'))

    expect(
      box.kit().isInsideGitWorkTree(path.join(box.places.home, '.config'))
    ).toBe(true)
  })

  it('reads a probe that throws as no repo at that level', () => {
    const box = sandbox({
      deps: {
        fs: fsWith({
          existsSync: () => {
            throw new Error('EACCES')
          }
        })
      }
    })

    expect(box.kit().isInsideGitWorkTree(box.root)).toBe(false)
  })
})

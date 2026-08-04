import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  isInsideGitWorkTree,
  loadOrCreateId,
  resolveTelemetryConsent
} from '../telemetry'

const originalEnv = {...process.env}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value
  }
}

let home = ''

beforeEach(() => {
  for (const key of [
    'CI',
    'GITHUB_ACTIONS',
    'EXTENSION_TELEMETRY',
    'EXTENSION_TELEMETRY_DISABLED'
  ]) {
    delete process.env[key]
  }
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-worktree-'))
  process.env.XDG_CONFIG_HOME = home
  process.env.XDG_CACHE_HOME = home
})

afterEach(() => {
  restoreEnv()
  fs.rmSync(home, {recursive: true, force: true})
})

const writeConsentFile = (value: string) => {
  const dir = path.join(home, 'extensionjs', 'telemetry')
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(path.join(dir, 'consent'), value, 'utf8')
}

const markAsWorkTree = () => {
  fs.mkdirSync(path.join(home, '.git'), {recursive: true})
}

describe('consent that arrived with a git clone is not consent', () => {
  it('honors a stored enabled outside any worktree', () => {
    writeConsentFile('ok')
    expect(resolveTelemetryConsent([])).toEqual({
      enabled: true,
      source: 'config'
    })
  })

  it('ignores a stored enabled inside a worktree, default notice applies', () => {
    writeConsentFile('ok')
    markAsWorkTree()
    expect(resolveTelemetryConsent([])).toEqual({
      enabled: true,
      source: 'default'
    })
  })

  it('still honors a stored refusal inside a worktree', () => {
    writeConsentFile('disabled')
    markAsWorkTree()
    expect(resolveTelemetryConsent([])).toEqual({
      enabled: false,
      source: 'config'
    })
  })
})

describe('a committed anonymous-id never aggregates strangers', () => {
  const idFileIn = (base: string) => {
    const dir = path.join(base, 'extensionjs', 'telemetry')
    fs.mkdirSync(dir, {recursive: true})
    const file = path.join(dir, 'anonymous-id')
    fs.writeFileSync(file, '0d66f514-e3bb-457c-a334-a194a58d0361', 'utf8')
    return file
  }

  it('adopts a stored id verbatim outside any worktree', () => {
    const file = idFileIn(home)
    expect(loadOrCreateId(file)).toBe('0d66f514-e3bb-457c-a334-a194a58d0361')
  })

  it('re-keys a stored id with a machine salt inside a worktree', () => {
    markAsWorkTree()
    const file = idFileIn(home)
    const first = loadOrCreateId(file)
    expect(first).not.toBe('0d66f514-e3bb-457c-a334-a194a58d0361')
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    // Stable per machine, so the counter still sees one machine as one.
    expect(loadOrCreateId(file)).toBe(first)
  })
})

describe('isInsideGitWorkTree boundaries', () => {
  it('flags a nested dir under a repo root', () => {
    markAsWorkTree()
    expect(isInsideGitWorkTree(path.join(home, 'a', 'b'))).toBe(true)
  })

  it('does not flag a plain dir', () => {
    expect(isInsideGitWorkTree(path.join(home, 'a', 'b'))).toBe(false)
  })

  it('stops at the home directory, a dotfiles repo at ~ is not foreign', () => {
    // A .git AT the fake home must not flag paths under it: the walk never
    // checks ~ itself, so a dotfiles repo rooted there stays machine state.
    markAsWorkTree()
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(home)
    try {
      expect(isInsideGitWorkTree(path.join(home, '.config'))).toBe(false)
    } finally {
      homedirSpy.mockRestore()
    }
  })
})

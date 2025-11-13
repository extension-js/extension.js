import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {cleanupOldTempProfiles} from '../shared-utils'

describe('cleanupOldTempProfiles', () => {
  let baseDir: string
  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profiles-'))
  })
  afterEach(() => {
    try {
      fs.rmSync(baseDir, {recursive: true, force: true})
    } catch {}
  })

  it('removes tmp-* dirs older than cutoff and keeps recent/current', () => {
    const oldDir = path.join(baseDir, 'tmp-old')
    const keepDir = path.join(baseDir, 'tmp-keep')
    const otherDir = path.join(baseDir, 'dev')
    fs.mkdirSync(oldDir, {recursive: true})
    fs.mkdirSync(keepDir, {recursive: true})
    fs.mkdirSync(otherDir, {recursive: true})

    // Set oldDir mtime to 2 days ago, keepDir to now
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)
    fs.utimesSync(oldDir, twoDaysAgo, twoDaysAgo)

    cleanupOldTempProfiles(baseDir, path.basename(keepDir), 12)

    expect(fs.existsSync(oldDir)).toBe(false)
    expect(fs.existsSync(keepDir)).toBe(true)
    expect(fs.existsSync(otherDir)).toBe(true)
  })
})

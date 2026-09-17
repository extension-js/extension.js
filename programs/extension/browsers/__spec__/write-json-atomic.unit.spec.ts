import {spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {writeJsonAtomic} from '../browsers-lib/write-json-atomic'

// A second process reads the file as fast as it can while this one rewrites
// it, and reports every read that was not whole JSON. A missing or locked
// file mid-swap is tolerated: the property under test is "never partial".
const readerSource = `
const fs = require('node:fs')
const [file, untilMs] = process.argv.slice(1)
const deadline = Date.now() + Number(untilMs)
let reads = 0
let partial = 0
let done = false
while (!done && Date.now() < deadline) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    continue
  }
  reads += 1
  try {
    done = JSON.parse(raw).done === true
  } catch {
    partial += 1
  }
}
process.stdout.write(JSON.stringify({reads, partial, done}))
`

function runReader(file: string, untilMs: number) {
  return new Promise<{reads: number; partial: number; done: boolean}>(
    (resolvePromise, reject) => {
      const child = spawn(
        process.execPath,
        ['-e', readerSource, file, String(untilMs)],
        {stdio: ['ignore', 'pipe', 'inherit']}
      )
      let stdout = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
      child.on('error', reject)
      child.on('close', () => {
        try {
          resolvePromise(JSON.parse(stdout))
        } catch (error) {
          reject(error)
        }
      })
    }
  )
}

describe('writeJsonAtomic', () => {
  let tmp: string
  let file: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'write-json-atomic-'))
    file = path.join(tmp, 'ready.json')
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('writes the pretty JSON and leaves no temp file behind', () => {
    expect(writeJsonAtomic(file, {status: 'ready', cdpPort: 9222})).toBe(true)

    expect(fs.readFileSync(file, 'utf-8')).toBe(
      JSON.stringify({status: 'ready', cdpPort: 9222}, null, 2)
    )

    expect(fs.readdirSync(tmp)).toEqual(['ready.json'])
  })

  // An in-place write keeps the inode; a rename swaps in the temp file's.
  // Windows file ids do not follow the same rule, so the race test covers it.
  it.skipIf(process.platform === 'win32')(
    'replaces an existing file through a rename, not an in-place write',
    () => {
      fs.writeFileSync(file, JSON.stringify({status: 'starting'}))
      const before = fs.statSync(file).ino

      expect(writeJsonAtomic(file, {status: 'ready'})).toBe(true)

      expect(fs.statSync(file).ino).not.toBe(before)
      expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({
        status: 'ready'
      })

      expect(fs.readdirSync(tmp)).toEqual(['ready.json'])
    }
  )

  it('removes the temp file and reports failure when the swap cannot land', () => {
    // A directory where the file should be makes the rename fail on every
    // platform, after the temp file was already written next to it.
    fs.mkdirSync(file)

    expect(writeJsonAtomic(file, {status: 'ready'})).toBe(false)

    expect(fs.readdirSync(tmp)).toEqual(['ready.json'])
    expect(fs.statSync(file).isDirectory()).toBe(true)
  })

  it('never lets a concurrent reader see a partial document', async () => {
    const big = 'x'.repeat(1024 * 1024)
    writeJsonAtomic(file, {done: false, seq: 0, big})

    const reader = runReader(file, 15_000)
    // Give the reader time to start polling before the rewrites begin, so
    // the loop below overlaps real reads instead of finishing first.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))

    // Windows can refuse a swap while the reader holds the file open, so
    // there the writes only have to land eventually, never partially.
    let landed = 0

    for (let seq = 1; seq <= 60; seq++) {
      if (writeJsonAtomic(file, {done: false, seq, big})) landed += 1
    }

    if (process.platform !== 'win32') expect(landed).toBe(60)

    for (let attempt = 0; attempt < 20; attempt++) {
      if (writeJsonAtomic(file, {done: true, seq: 61, big})) break

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }

    const report = await reader
    expect(landed).toBeGreaterThan(0)
    expect(report.partial).toBe(0)
    expect(report.reads).toBeGreaterThan(0)
    expect(report.done).toBe(true)
    expect(fs.readdirSync(tmp)).toEqual(['ready.json'])
  })
})

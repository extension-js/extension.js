import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {makeWriter as makeProjectWriter} from './helpers/contract'

// A reader that holds ready.json open refuses the rename on Windows. The
// writer takes the rename, the platform and the wait, so every host runs this.
describe('ready.json writer while a Windows reader holds the file', () => {
  let tmp: string
  let remaining: number
  let readyCalls: number
  let waits: number[]

  beforeEach(() => {
    remaining = 0
    readyCalls = 0
    waits = []
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-writer-lock-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (platform: NodeJS.Platform = 'win32') =>
    makeProjectWriter(tmp, {
      renameRetry: {
        platform,
        sleep: (ms) => waits.push(ms),
        rename(from, to) {
          if (to.endsWith('ready.json')) {
            readyCalls += 1

            if (remaining > 0) {
              remaining -= 1

              throw Object.assign(new Error('EPERM: operation not permitted'), {
                code: 'EPERM'
              })
            }
          }

          fs.renameSync(from, to)
        }
      }
    })

  const tempFiles = (readyPath: string) =>
    fs
      .readdirSync(path.dirname(readyPath))
      .filter((name) => name.includes('.tmp-'))

  it('lands the ready stamp once the reader releases the file', () => {
    const writer = makeWriter()
    remaining = 2

    writer.writeReady()

    expect(readyCalls).toBe(3)
    expect(waits).toEqual([10, 20])
    expect(JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8')).status).toBe(
      'ready'
    )

    expect(tempFiles(writer.readyPath)).toEqual([])
  })

  it('leaves no temp file and does not throw when the lock never clears', () => {
    const writer = makeWriter()
    remaining = 100

    expect(() => writer.writeReady()).not.toThrow()

    expect(readyCalls).toBe(7)
    expect(waits).toEqual([10, 20, 40, 80, 160, 320])
    expect(tempFiles(writer.readyPath)).toEqual([])
  })

  it('does not retry on a host where a held file takes the rename', () => {
    const writer = makeWriter('linux')
    remaining = 1

    expect(() => writer.writeReady()).not.toThrow()

    expect(readyCalls).toBe(1)
    expect(waits).toEqual([])
    expect(tempFiles(writer.readyPath)).toEqual([])
  })
})

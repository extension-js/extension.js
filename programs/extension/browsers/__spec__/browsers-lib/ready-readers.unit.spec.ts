import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  readReadyDevAdditions,
  readReadyExecutorAttached,
  readReadyRunId,
  readyPathFor
} from '../../browsers-lib/ready-stamp'

// What each launcher reader answers over a ready.json it cannot use. A poller
// meets these files for real: the writer swaps the file while it is read.
const UNUSABLE: Array<[string, string | undefined]> = [
  ['a missing file', undefined],
  ['an empty file', ''],
  ['a half-written file', '{"runId": "run-A", "devAdd'],
  ['a file that holds null', 'null'],
  ['a file that holds a number', '7'],
  ['a file that holds a string', '"run-A"'],
  ['a file that holds a list', '[{"runId": "run-A"}]'],
  ['a file that holds true', 'true']
]

describe('the launcher readers of ready.json', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  const put = (text: string | undefined) => {
    if (text === undefined) return

    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(readyPath, text)
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-readers-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = readyPathFor(outputPath)
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it.each(UNUSABLE)('read no run id from %s', (_name, text) => {
    put(text)

    expect(readReadyRunId(outputPath)).toBeUndefined()
  })

  it.each(UNUSABLE)('read no attach from %s', (_name, text) => {
    put(text)

    expect(readReadyExecutorAttached(outputPath)).toBe(false)
    expect(readReadyExecutorAttached(outputPath, 'run-A')).toBe(false)
  })

  it.each(UNUSABLE)('read no dev additions from %s', (_name, text) => {
    put(text)

    expect(readReadyDevAdditions(outputPath)).toEqual([])
  })

  it.each(UNUSABLE)('leave %s as it was', (_name, text) => {
    put(text)

    readReadyRunId(outputPath)
    readReadyExecutorAttached(outputPath)
    readReadyDevAdditions(outputPath)

    expect(fs.existsSync(readyPath)).toBe(text !== undefined)

    if (text !== undefined) {
      expect(fs.readFileSync(readyPath, 'utf-8')).toBe(text)
    }
  })

  it('answer nothing without a build folder', () => {
    expect(readReadyRunId(undefined)).toBeUndefined()
    expect(readReadyExecutorAttached(undefined)).toBe(false)
    expect(readReadyDevAdditions(undefined)).toEqual([])
  })

  it('read the run id only as a non-empty string of this process', () => {
    put(JSON.stringify({runId: 7}))
    expect(readReadyRunId(outputPath)).toBeUndefined()

    put(JSON.stringify({runId: ''}))
    expect(readReadyRunId(outputPath)).toBeUndefined()

    put(JSON.stringify({runId: 'run-A'}))
    expect(readReadyRunId(outputPath)).toBe('run-A')

    put(JSON.stringify({runId: 'run-A', pid: process.pid}))
    expect(readReadyRunId(outputPath)).toBe('run-A')

    put(JSON.stringify({runId: 'run-A', pid: process.pid + 1}))
    expect(readReadyRunId(outputPath)).toBe('run-of-another-process')

    put(JSON.stringify({pid: process.pid + 1}))
    expect(readReadyRunId(outputPath)).toBe('run-of-another-process')
  })

  it('read the attach off either field, and only for the run asked', () => {
    put(JSON.stringify({runId: 'run-A'}))
    expect(readReadyExecutorAttached(outputPath)).toBe(false)

    put(JSON.stringify({runId: 'run-A', executorAttachedAt: 7}))
    expect(readReadyExecutorAttached(outputPath)).toBe(false)

    put(JSON.stringify({runId: 'run-A', executorAttachedAt: '2026-11-01'}))
    expect(readReadyExecutorAttached(outputPath)).toBe(true)
    expect(readReadyExecutorAttached(outputPath, 'run-A')).toBe(true)
    expect(readReadyExecutorAttached(outputPath, 'run-B')).toBe(false)

    put(JSON.stringify({runtime: 'attached'}))
    expect(readReadyExecutorAttached(outputPath, 'run-B')).toBe(true)

    put(JSON.stringify({runtime: 'detached'}))
    expect(readReadyExecutorAttached(outputPath)).toBe(false)
  })

  it('read only the dev additions that carry a kind and a value', () => {
    put(JSON.stringify({devAdditions: 'none'}))
    expect(readReadyDevAdditions(outputPath)).toEqual([])

    put(
      JSON.stringify({
        devAdditions: [
          null,
          'flag',
          {kind: 'permission'},
          {kind: 7, value: 'tabs'},
          {kind: 'permission', value: 'tabs', reason: 'reload'}
        ]
      })
    )

    expect(readReadyDevAdditions(outputPath)).toEqual([
      {kind: 'permission', value: 'tabs', reason: 'reload'}
    ])
  })
})

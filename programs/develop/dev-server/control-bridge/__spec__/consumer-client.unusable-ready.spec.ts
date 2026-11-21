import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {findLiveDevSession} from '../../../lib/live-dev-session'
import {
  readExtensionLoadRefusal,
  readReadyContract,
  readReadyContractDocument
} from '../consumer-client'

// What the published readers answer over a ready.json they cannot use. A
// consumer polls the file while the engine swaps it, so each case is real.
const UNUSABLE: Array<[string, string | undefined]> = [
  ['a missing file', undefined],
  ['an empty file', ''],
  ['a half-written file', '{"controlPort": 8147, "instanceId": "in'],
  ['a file that holds null', 'null'],
  ['a file that holds a number', '7'],
  ['a file that holds a string', '"ready"'],
  ['a file that holds a list', '[{"controlPort": 8147, "instanceId": "i"}]'],
  ['a file that holds true', 'true']
]

describe('the published readers of ready.json', () => {
  let dir: string
  let readyPath: string

  const put = (text: string | undefined) => {
    if (text === undefined) return

    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(readyPath, text)
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-unusable-ready-'))
    readyPath = path.join(dir, 'dist', 'extension-js', 'chrome', 'ready.json')
  })

  afterEach(() => fs.rmSync(dir, {recursive: true, force: true}))

  it.each(UNUSABLE)('answer null over %s', (_name, text) => {
    put(text)

    expect(readReadyContract(dir, 'chrome')).toBeNull()
    expect(readReadyContractDocument(dir, 'chrome')).toBeNull()
    expect(readExtensionLoadRefusal(dir, 'chrome')).toBeNull()
    expect(findLiveDevSession(dir, 'chrome')).toBeNull()

    expect(fs.existsSync(readyPath)).toBe(text !== undefined)

    if (text !== undefined) {
      expect(fs.readFileSync(readyPath, 'utf-8')).toBe(text)
    }
  })

  it('hand the whole document through, and the narrow one its typed fields', () => {
    put(
      JSON.stringify({
        controlPort: 8147,
        instanceId: 7,
        runId: 'run-A',
        logsPath: 'dist/extension-js/chrome/logs.ndjson',
        status: 'ready',
        pid: 'not-a-pid',
        fieldOfALaterEngine: {kept: true}
      })
    )

    expect(readReadyContractDocument(dir, 'chrome')).toEqual({
      controlPort: 8147,
      instanceId: 7,
      runId: 'run-A',
      logsPath: 'dist/extension-js/chrome/logs.ndjson',
      status: 'ready',
      pid: 'not-a-pid',
      fieldOfALaterEngine: {kept: true}
    })

    const narrow = readReadyContract(dir, 'chrome')

    expect(narrow).toMatchObject({
      controlPort: 8147,
      instanceId: '7',
      runId: 'run-A',
      logsPath: 'dist/extension-js/chrome/logs.ndjson',
      status: 'ready'
    })

    expect(narrow?.pid).toBeUndefined()
    expect(narrow && 'fieldOfALaterEngine' in narrow).toBe(false)
  })

  it('answer null from the narrow reader without a port or an instance', () => {
    put(JSON.stringify({controlPort: '8147', instanceId: 'i'}))
    expect(readReadyContract(dir, 'chrome')).toBeNull()

    put(JSON.stringify({controlPort: 8147, instanceId: ''}))
    expect(readReadyContract(dir, 'chrome')).toBeNull()
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {stampLogCaptureFaults} from '../../browsers-lib/log-capture-fault'

// A dev contract beside the build folder the launcher is handed.
let root: string
let output: string
let readyPath: string

beforeEach(() => {
  expect.hasAssertions()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-log-capture-'))
  output = path.join(root, 'dist', 'chrome')
  readyPath = path.join(root, 'dist', 'extension-js', 'chrome', 'ready.json')
  fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  fs.writeFileSync(
    readyPath,
    JSON.stringify({status: 'ready', browser: 'chrome', pid: process.pid})
  )
})

afterEach(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

const readContract = () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

function controllerFailingWith(error: unknown) {
  return stampLogCaptureFaults(
    {
      enableUnifiedLogging: async () => {
        throw error
      }
    },
    output
  )
}

describe('a browser log capture that fails after launch', () => {
  it('names the fault under its warning code and still throws to the caller', async () => {
    const error = Object.assign(new Error('Log.enable timed out'), {
      code: 'E_CDP_TIMEOUT'
    })

    await expect(
      controllerFailingWith(error).enableUnifiedLogging({})
    ).rejects.toBe(error)

    expect(readContract()).toMatchObject({
      status: 'ready',
      cdpFaultCode: 'W_CDP_TIMEOUT',
      cdpFaultMessage: 'browser log capture failed: Log.enable timed out'
    })
  })

  it('files a fault with no class of its own under the catch-all warning', async () => {
    await expect(
      controllerFailingWith(new Error('logging refused')).enableUnifiedLogging(
        {}
      )
    ).rejects.toThrow('logging refused')

    expect(readContract().cdpFaultCode).toBe('W_CDP_OP_FAILED')
  })

  it('leaves the contract alone when the capture starts', async () => {
    const controller = stampLogCaptureFaults(
      {enableUnifiedLogging: async () => {}},
      output
    )

    await controller.enableUnifiedLogging({level: 'info'})

    expect(readContract()).toEqual({
      status: 'ready',
      browser: 'chrome',
      pid: process.pid
    })
  })
})

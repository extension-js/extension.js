import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {stampReadyRdpPort} from '../browsers-lib/ready-stamp'

describe('stampReadyRdpPort (§78)', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-'))
    outputPath = path.join(tmp, 'dist', 'firefox')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'firefox', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('publishes the RDP debugger-server port into ready.json', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({status: 'ready', browser: 'firefox', runId: 'run-A'})
    )

    stampReadyRdpPort(outputPath, 6006)

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.rdpPort).toBe(6006)
    expect(ready.status).toBe('ready')
    expect(ready.runId).toBe('run-A')
  })

  it('is a no-op when the contract file does not exist yet', () => {
    expect(() => stampReadyRdpPort(outputPath, 6006)).not.toThrow()
    expect(fs.existsSync(readyPath)).toBe(false)
  })

  it('is a no-op for a missing output path or non-finite port', () => {
    fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))
    stampReadyRdpPort(undefined, 6006)
    stampReadyRdpPort(outputPath, Number.NaN)
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect('rdpPort' in ready).toBe(false)
  })
})

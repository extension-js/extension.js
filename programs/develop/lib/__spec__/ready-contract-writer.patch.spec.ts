import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {ownProcessStartedAt, ownProcessStartId} from '../process-started-at'
import {
  carryStampedFields,
  type PidStartProbes,
  patchReadyRecord,
  type ReadyRecord,
  readReadyRecord,
  stampLaunchedProcess,
  writerIdentity
} from '../ready-contract-writer'

describe('the one writer of ready.json, called with a patch', () => {
  let tmp: string
  let file: string

  const onDisk = () => JSON.parse(fs.readFileSync(file, 'utf-8')) as ReadyRecord

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-patch-'))
    file = path.join(tmp, 'ready.json')
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('changes the patched fields and keeps every other one, known or not', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({status: 'starting', runId: 'r1', fieldOfALaterEngine: 7})
    )

    const result = patchReadyRecord(file, (ready) => {
      ready.status = 'ready'
      ready.cdpPort = 9222

      return undefined
    })

    expect(result).toEqual({written: true})
    expect(onDisk()).toEqual({
      status: 'ready',
      runId: 'r1',
      fieldOfALaterEngine: 7,
      cdpPort: 9222
    })

    expect(fs.readFileSync(file, 'utf-8').endsWith('}\n')).toBe(true)
    expect(fs.readdirSync(tmp)).toEqual(['ready.json'])
  })

  it('leaves the file alone when the patch answers false', () => {
    const text = JSON.stringify({status: 'ready'})
    fs.writeFileSync(file, text)

    const result = patchReadyRecord(file, (ready) => {
      ready.status = 'error'

      return false
    })

    expect(result).toEqual({written: false})
    expect(fs.readFileSync(file, 'utf-8')).toBe(text)
  })

  it.each([
    ['a missing file', undefined],
    ['a half-written file', '{"status": "rea'],
    ['a file that holds no object', 'null']
  ])('never calls the patch over %s, and creates nothing', (_name, text) => {
    if (text !== undefined) fs.writeFileSync(file, text)

    let called = false
    const result = patchReadyRecord(file, () => {
      called = true

      return undefined
    })

    expect(called).toBe(false)
    expect(result).toEqual({written: false})
    expect(readReadyRecord(file)).toBeUndefined()
    expect(fs.existsSync(file)).toBe(text !== undefined)
  })

  it('hands back the error of a write that could not land', () => {
    fs.writeFileSync(file, JSON.stringify({status: 'starting'}))

    const result = patchReadyRecord(
      file,
      (ready) => {
        ready.status = 'ready'

        return undefined
      },
      {
        rename() {
          throw Object.assign(new Error('EXDEV: no'), {code: 'EXDEV'})
        }
      }
    )

    expect(result.written).toBe(false)
    expect(result.error?.message).toBe('EXDEV: no')
    expect(onDisk()).toEqual({status: 'starting'})
    expect(fs.readdirSync(tmp)).toEqual(['ready.json'])
  })

  it('retries the rename a Windows reader refuses, through the same seam', () => {
    fs.writeFileSync(file, JSON.stringify({status: 'starting'}))

    let refusals = 2
    const waits: number[] = []

    const result = patchReadyRecord(
      file,
      (ready) => {
        ready.status = 'ready'

        return undefined
      },
      {
        platform: 'win32',
        sleep: (ms) => waits.push(ms),
        rename(from, to) {
          if (refusals-- > 0) {
            throw Object.assign(new Error('EPERM'), {code: 'EPERM'})
          }

          fs.renameSync(from, to)
        }
      }
    )

    expect(result).toEqual({written: true})
    expect(waits).toEqual([10, 20])
    expect(onDisk()).toEqual({status: 'ready'})
  })
})

describe('what a whole rewrite of ready.json carries', () => {
  it('keeps every earlier field the writer neither computes nor has set', () => {
    const next: ReadyRecord = {status: 'ready', extensionId: 'from-this-write'}

    carryStampedFields(
      next,
      {
        status: 'error',
        code: 'compile_error',
        cdpPort: 9222,
        extensionId: 'earlier',
        fieldOfALaterLauncher: {nested: true}
      },
      new Set(['status', 'code'])
    )

    expect(next).toEqual({
      status: 'ready',
      extensionId: 'from-this-write',
      cdpPort: 9222,
      fieldOfALaterLauncher: {nested: true}
    })
  })
})

describe('the identity fields of ready.json', () => {
  const probes = (
    startedAt: string | undefined,
    startId: string | undefined
  ): PidStartProbes & {asked: number[]} => {
    const asked: number[] = []

    return {
      asked,
      startedAt: (pid) => {
        asked.push(pid)

        return startedAt
      },
      startId: () => startId
    }
  }

  it('names the writing process by pid, start time and start id', () => {
    const identity = writerIdentity()

    expect(identity.pid).toBe(process.pid)
    expect(identity.pidStartedAt).toBe(ownProcessStartedAt())
    expect(identity.pidStartId).toBe(ownProcessStartId())
    expect('pidStartId' in identity).toBe(process.platform === 'linux')
    expect(Object.keys(identity).slice(0, 2)).toEqual(['pid', 'pidStartedAt'])
  })

  it.each([
    ['browser', ['browserPid', 'browserStartedAt', 'browserStartId']],
    ['launcher', ['launcherPid', 'launcherStartedAt', 'launcherStartId']]
  ] as const)('stamps the %s pid with its start time and id', (which, fields) => {
    const ready: ReadyRecord = {}

    stampLaunchedProcess(
      ready,
      which,
      4242,
      probes('2026-11-01T00:00:00.000Z', 'boot:77')
    )

    expect(ready).toEqual({
      [fields[0]]: 4242,
      [fields[1]]: '2026-11-01T00:00:00.000Z',
      [fields[2]]: 'boot:77'
    })
  })

  it('asks the process table once per pid and keeps the answer', () => {
    const ready: ReadyRecord = {}
    const first = probes('2026-11-01T00:00:00.000Z', undefined)
    const second = probes('2026-11-02T00:00:00.000Z', 'boot:1')

    stampLaunchedProcess(ready, 'browser', 10, first)
    stampLaunchedProcess(ready, 'browser', 10, second)

    expect(second.asked).toEqual([])
    expect(ready).toEqual({
      browserPid: 10,
      browserStartedAt: '2026-11-01T00:00:00.000Z'
    })
  })

  it('drops the earlier pid start facts when a new pid cannot be dated', () => {
    const ready: ReadyRecord = {
      browserPid: 10,
      browserStartedAt: '2026-11-01T00:00:00.000Z',
      browserStartId: 'boot:1'
    }

    stampLaunchedProcess(ready, 'browser', 11, probes(undefined, undefined))

    expect(ready).toEqual({browserPid: 11})
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {type ActionRecord, ActionsFileWriter} from '../actions-file'
import type {LogEvent} from '../contracts'
import {LogsFileWriter, replaceLogFile} from '../logs-file'

// The hooks run inside the writer's own file calls, which is the only way to
// start a newer session between an ownership check and the append after it.
const hooks = vi.hoisted(() => ({
  afterHeaderRead: null as null | (() => void),
  afterAppendOpen: null as null | (() => void),
  failRenameOnto: null as null | string
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  const readSync = ((...args: Parameters<typeof actual.readSync>) => {
    const read = actual.readSync(...args)
    const hook = hooks.afterHeaderRead

    if (hook) {
      hooks.afterHeaderRead = null
      hook()
    }

    return read
  }) as typeof actual.readSync

  const openSync = ((...args: Parameters<typeof actual.openSync>) => {
    const fd = actual.openSync(...args)
    const hook = hooks.afterAppendOpen

    if (hook && args[1] === 'a') {
      hooks.afterAppendOpen = null
      hook()
    }

    return fd
  }) as typeof actual.openSync

  const renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
    if (hooks.failRenameOnto !== null && String(to) === hooks.failRenameOnto) {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), {
        code: 'EPERM'
      })
    }

    actual.renameSync(from, to)
  }) as typeof actual.renameSync

  return {...actual, readSync, openSync, renameSync}
})

// Windows can refuse a rename onto a file with an open descriptor, and the
// writer then truncates in place, which is the one gap the platform leaves.
const renameOverOpenFileCanFail = process.platform === 'win32'

let dir: string
let logPath: string
let actionsPath: string

function event(seq: number, message: string, runId: string): LogEvent {
  return {
    v: 1,
    id: `id-${seq}`,
    seq,
    timestamp: 0,
    level: 'info',
    context: 'background',
    messageParts: [message],
    runId
  }
}

function record(cmdId: string): ActionRecord {
  return {
    v: 1,
    ts: '2026-01-01T00:00:00.000Z',
    cmdId,
    op: 'eval',
    target: {context: 'background'},
    ok: true,
    principal: 'agent'
  }
}

function rows(file: string): any[] {
  if (!fs.existsSync(file)) return []

  return fs
    .readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function messagesIn(file: string): string[] {
  return rows(file)
    .filter((row) => Array.isArray(row.messageParts))
    .map((row) => String(row.messageParts[0]))
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-late-flush-'))
  logPath = path.join(dir, 'logs.ndjson')
  actionsPath = path.join(dir, 'actions.ndjson')
})

afterEach(() => {
  hooks.afterHeaderRead = null
  hooks.afterAppendOpen = null
  hooks.failRenameOnto = null
  fs.rmSync(dir, {recursive: true, force: true})
})

describe('a newer session that starts between the ownership check and the append', () => {
  it('receives no row of the late flush, which stays in the old run file', () => {
    const oldRun = new LogsFileWriter({filePath: logPath, runId: 'run-A'})
    oldRun.start()
    oldRun.write(event(1, 'old-early', 'run-A'))
    oldRun.flush()
    oldRun.write(event(2, 'old-late', 'run-A'))

    const newRun = new LogsFileWriter({filePath: logPath, runId: 'run-B'})

    hooks.afterHeaderRead = () => {
      newRun.start()
      newRun.write(event(1, 'new-first', 'run-B'))
      newRun.flush()
    }

    oldRun.close()
    newRun.close()

    expect(hooks.afterHeaderRead).toBeNull()
    expect(rows(logPath)[0]).toMatchObject({type: 'header', runId: 'run-B'})
    expect(messagesIn(logPath)).toEqual(['new-first'])

    const rotated = path.join(dir, 'logs.1.ndjson')

    expect(rows(rotated)[0]).toMatchObject({type: 'header', runId: 'run-A'})
    expect(messagesIn(rotated)).toEqual(['old-early', 'old-late'])
  })

  it.skipIf(renameOverOpenFileCanFail)(
    'receives no row of the late flush when the old file could not be rotated away',
    () => {
      const oldRun = new LogsFileWriter({filePath: logPath, runId: 'run-A'})
      oldRun.start()
      oldRun.write(event(1, 'old-late', 'run-A'))

      const newRun = new LogsFileWriter({filePath: logPath, runId: 'run-B'})

      hooks.afterHeaderRead = () => {
        // The rotation fails, so only the header write can replace the file.
        hooks.failRenameOnto = path.join(dir, 'logs.1.ndjson')
        newRun.start()
        hooks.failRenameOnto = null
      }

      oldRun.close()
      newRun.close()

      expect(rows(logPath)).toHaveLength(1)
      expect(rows(logPath)[0]).toMatchObject({type: 'header', runId: 'run-B'})
      expect(
        fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))
      ).toEqual([])
    }
  )

  it('receives no action row of the late write, which stays in the old run file', () => {
    const oldLogs = new LogsFileWriter({filePath: logPath, runId: 'run-A'})
    oldLogs.start()

    const oldActions = new ActionsFileWriter({
      filePath: actionsPath,
      owner: {runId: 'run-A', logsFilePath: logPath}
    })
    oldActions.start()
    oldActions.write(record('old-early'))

    const newLogs = new LogsFileWriter({filePath: logPath, runId: 'run-B'})
    const newActions = new ActionsFileWriter({
      filePath: actionsPath,
      owner: {runId: 'run-B', logsFilePath: logPath}
    })

    // The old run holds its descriptor and has not yet looked at the header.
    hooks.afterAppendOpen = () => {
      newLogs.start()
      newActions.start()
    }

    oldActions.write(record('old-late'))
    expect(hooks.afterAppendOpen).toBeNull()

    newActions.write(record('new-first'))
    newLogs.close()
    oldLogs.close()

    expect(rows(actionsPath).map((row) => row.cmdId)).toEqual(['new-first'])
    expect(
      rows(path.join(dir, 'actions.1.ndjson')).map((row) => row.cmdId)
    ).toEqual(['old-early'])
  })

  it('leaves the old action row in the old file when the newer run starts after both checks', () => {
    const oldLogs = new LogsFileWriter({filePath: logPath, runId: 'run-A'})
    oldLogs.start()

    const oldActions = new ActionsFileWriter({
      filePath: actionsPath,
      owner: {runId: 'run-A', logsFilePath: logPath}
    })
    oldActions.start()
    oldActions.write(record('old-early'))

    const newLogs = new LogsFileWriter({filePath: logPath, runId: 'run-B'})
    const newActions = new ActionsFileWriter({
      filePath: actionsPath,
      owner: {runId: 'run-B', logsFilePath: logPath}
    })
    let headerReads = 0

    // Read one is the check before the open, read two the check after it.
    const armSecondRead = () => {
      hooks.afterHeaderRead = () => {
        headerReads += 1

        if (headerReads < 2) return armSecondRead()

        newLogs.start()
        newActions.start()
      }
    }

    armSecondRead()
    oldActions.write(record('old-late'))
    newActions.write(record('new-first'))
    newLogs.close()
    oldLogs.close()

    expect(headerReads).toBe(2)
    expect(rows(actionsPath).map((row) => row.cmdId)).toEqual(['new-first'])
    expect(
      rows(path.join(dir, 'actions.1.ndjson')).map((row) => row.cmdId)
    ).toEqual(['old-early', 'old-late'])
  })
})

describe('replaceLogFile', () => {
  it.skipIf(renameOverOpenFileCanFail)(
    'gives the path a new file, so a descriptor on the old one keeps the old content',
    () => {
      fs.writeFileSync(logPath, 'old\n')

      const held = fs.openSync(logPath, 'a+')

      try {
        replaceLogFile(logPath, 'new\n')
        fs.appendFileSync(held, 'late\n')
      } finally {
        fs.closeSync(held)
      }

      expect(fs.readFileSync(logPath, 'utf-8')).toBe('new\n')
      expect(
        fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))
      ).toEqual([])
    }
  )

  it('falls back to writing in place when the rename is refused', () => {
    fs.writeFileSync(logPath, 'old\n')
    hooks.failRenameOnto = logPath
    replaceLogFile(logPath, 'new\n')

    expect(fs.readFileSync(logPath, 'utf-8')).toBe('new\n')
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual(
      []
    )
  })
})

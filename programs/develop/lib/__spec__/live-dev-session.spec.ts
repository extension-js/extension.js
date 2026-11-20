import {type ChildProcess, spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {findLiveDevSession, isSessionPidLive} from '../live-dev-session'
import {readyContractPath} from '../session-paths'

const makeTempFolder = trackTempFolders()

// A real process that stays up for the file, and one that has already exited.
let live: ChildProcess
let deadPid = 0

beforeAll(async () => {
  live = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore'
  })

  const gone = spawn(process.execPath, ['-e', ''], {stdio: 'ignore'})
  deadPid = Number(gone.pid)

  await new Promise<void>((resolve) => gone.once('exit', () => resolve()))
})

afterAll(() => {
  live?.kill('SIGKILL')
})

function projectWith(contract: unknown, browser = 'chrome'): string {
  const project = makeTempFolder('extjs-live-dev-session-')
  const file = readyContractPath(project, browser)

  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(
    file,
    typeof contract === 'string' ? contract : JSON.stringify(contract)
  )

  return project
}

describe('findLiveDevSession', () => {
  it('names the dist and the pid of a dev session whose producer runs', () => {
    const project = projectWith({
      command: 'dev',
      status: 'ready',
      pid: live.pid,
      distPath: path.join('some', 'dist', 'chrome')
    })

    expect(findLiveDevSession(project, 'chrome')).toEqual({
      distPath: path.resolve('some', 'dist', 'chrome'),
      pid: live.pid
    })
  })

  // Windows does not date pids (processStartedAtMs answers null there), so
  // liveness alone decides and this row cannot hold on win32.
  it.skipIf(process.platform === 'win32')(
    'finds nobody behind a live pid that started after its contract said',
    () => {
      const project = projectWith({
        command: 'dev',
        status: 'ready',
        pid: live.pid,
        pidStartedAt: '2000-01-01T00:00:00.000Z'
      })

      expect(findLiveDevSession(project, 'chrome')).toBeNull()
    }
  )

  // What every reader on Windows sees: a pid that cannot be dated counts as
  // the writer while it lives, whatever start the contract stamped.
  it('trusts a live pid whose start cannot be dated, as on Windows', () => {
    const contract = {pid: 4242, pidStartedAt: '2000-01-01T00:00:00.000Z'}

    expect(
      isSessionPidLive(contract, {
        isAlive: () => true,
        startedAtOf: () => null
      })
    ).toBe(true)

    expect(
      isSessionPidLive(contract, {
        isAlive: () => false,
        startedAtOf: () => null
      })
    ).toBe(false)
  })

  // Linux dates a start off the wall clock as it reads now, so after a clock
  // step the process table disagrees with the stamp of a session that lives.
  it('trusts the stamped start id over dates a clock step moved apart', () => {
    const contract = {
      pid: 4242,
      pidStartedAt: '2026-11-20T10:00:00.000Z',
      pidStartId: 'boot-a:5000'
    }
    const steppedByAnHour = () => Date.parse('2026-11-20T11:00:00.000Z')

    expect(
      isSessionPidLive(contract, {
        isAlive: () => true,
        startedAtOf: steppedByAnHour,
        startIdOf: () => 'boot-a:5000'
      })
    ).toBe(true)
  })

  it('finds a reused pid by its start id even when the dates agree', () => {
    const contract = {
      pid: 4242,
      pidStartedAt: '2026-11-20T10:00:00.000Z',
      pidStartId: 'boot-a:5000'
    }
    const sameSecond = () => Date.parse('2026-11-20T10:00:00.000Z')

    for (const startId of ['boot-a:5001', 'boot-b:5000']) {
      expect(
        isSessionPidLive(contract, {
          isAlive: () => true,
          startedAtOf: sameSecond,
          startIdOf: () => startId
        })
      ).toBe(false)
    }
  })

  it('reads the dates when either side has no start id', () => {
    const stamped = '2026-11-20T10:00:00.000Z'
    const far = () => Date.parse('2026-11-20T11:00:00.000Z')

    // An older writer stamped none.
    expect(
      isSessionPidLive(
        {pid: 4242, pidStartedAt: stamped},
        {isAlive: () => true, startedAtOf: far, startIdOf: () => 'boot-a:1'}
      )
    ).toBe(false)

    // The reader cannot name the live process, as on macOS and Windows.
    expect(
      isSessionPidLive(
        {pid: 4242, pidStartedAt: stamped, pidStartId: 'boot-a:1'},
        {isAlive: () => true, startedAtOf: far, startIdOf: () => undefined}
      )
    ).toBe(false)

    expect(
      isSessionPidLive(
        {pid: 4242, pidStartedAt: stamped, pidStartId: 'boot-a:1'},
        {
          isAlive: () => true,
          startedAtOf: () => Date.parse(stamped) + 1000,
          startIdOf: () => undefined
        }
      )
    ).toBe(true)
  })

  it('counts a session that is still starting', () => {
    const project = projectWith({
      command: 'dev',
      status: 'starting',
      pid: live.pid
    })

    expect(findLiveDevSession(project, 'chrome')).toEqual({
      distPath: '',
      pid: live.pid
    })
  })

  it('reads the contract of the browser it is asked about', () => {
    const project = projectWith(
      {command: 'dev', status: 'ready', pid: live.pid},
      'firefox'
    )

    expect(findLiveDevSession(project, 'chrome')).toBeNull()
    expect(findLiveDevSession(project, 'firefox')?.pid).toBe(live.pid)
  })

  it('finds nobody behind a contract whose producer exited', () => {
    const project = projectWith({
      command: 'dev',
      status: 'ready',
      pid: deadPid
    })

    expect(findLiveDevSession(project, 'chrome')).toBeNull()
  })

  it('finds nobody behind a stopped or errored contract', () => {
    for (const status of ['stopped', 'error', undefined]) {
      const project = projectWith({command: 'dev', status, pid: live.pid})

      expect(findLiveDevSession(project, 'chrome')).toBeNull()
    }
  })

  it('finds nobody behind a contract another command wrote', () => {
    for (const command of ['build', 'start', 'preview']) {
      const project = projectWith({command, status: 'ready', pid: live.pid})

      expect(findLiveDevSession(project, 'chrome')).toBeNull()
    }
  })

  it('never names the asking process as the session in its way', () => {
    const project = projectWith({
      command: 'dev',
      status: 'ready',
      pid: process.pid
    })

    expect(findLiveDevSession(project, 'chrome')).toBeNull()
  })

  it('finds nobody behind a pid that is not a process id', () => {
    for (const pid of [0, -1, 1.5, 'abc', null, undefined]) {
      const project = projectWith({command: 'dev', status: 'ready', pid})

      expect(findLiveDevSession(project, 'chrome')).toBeNull()
    }
  })

  it('finds nobody when the contract is missing, broken or not an object', () => {
    expect(
      findLiveDevSession(makeTempFolder('extjs-live-dev-session-'), 'chrome')
    ).toBeNull()

    expect(findLiveDevSession(projectWith('{"command":'), 'chrome')).toBeNull()
    expect(findLiveDevSession(projectWith('null'), 'chrome')).toBeNull()
    expect(findLiveDevSession(projectWith('"dev"'), 'chrome')).toBeNull()
  })
})

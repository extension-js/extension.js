import {type ChildProcess, spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {findLiveDevSession} from '../live-dev-session'
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

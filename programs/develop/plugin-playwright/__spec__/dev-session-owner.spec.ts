import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {detectLiveDevSessionOwner, shouldWarnDevOverDev} from '../index'

function writeReadyFixture(overrides: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-owner-'))
  const readyPath = path.join(dir, 'ready.json')
  fs.writeFileSync(
    readyPath,
    JSON.stringify({
      command: 'dev',
      status: 'ready',
      pid: 424242,
      runId: 'f3a9',
      instanceId: 'alpha',
      ...overrides
    })
  )
  return readyPath
}

const alive = () => true
const dead = () => false

describe('detectLiveDevSessionOwner', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns the owner for a live same-target dev session', () => {
    const owner = detectLiveDevSessionOwner(
      writeReadyFixture({instanceExplicit: true}),
      alive
    )
    expect(owner).toEqual({
      pid: 424242,
      runId: 'f3a9',
      instanceId: 'alpha',
      instanceExplicit: true
    })
  })

  it('returns null when the recorded pid is gone', () => {
    expect(detectLiveDevSessionOwner(writeReadyFixture(), dead)).toBeNull()
  })

  it('returns null for a non-dev contract', () => {
    const readyPath = writeReadyFixture({command: 'build'})
    expect(detectLiveDevSessionOwner(readyPath, alive)).toBeNull()
  })

  it('returns null for a stopped session', () => {
    const readyPath = writeReadyFixture({status: 'stopped'})
    expect(detectLiveDevSessionOwner(readyPath, alive)).toBeNull()
  })

  it('returns null for its own pid', () => {
    const readyPath = writeReadyFixture({pid: process.pid})
    expect(detectLiveDevSessionOwner(readyPath, alive)).toBeNull()
  })

  it('returns null when no contract exists', () => {
    expect(
      detectLiveDevSessionOwner(path.join(os.tmpdir(), 'nope', 'ready.json'))
    ).toBeNull()
  })

  it('tolerates a missing runId and instanceId', () => {
    const readyPath = writeReadyFixture({
      runId: undefined,
      instanceId: undefined
    })
    expect(detectLiveDevSessionOwner(readyPath, alive)).toEqual({
      pid: 424242,
      runId: '',
      instanceId: undefined,
      instanceExplicit: false
    })
  })
})

describe('shouldWarnDevOverDev', () => {
  it('warns when both sessions run auto-generated instances', () => {
    expect(
      shouldWarnDevOverDev(
        {pid: 1, runId: 'r', instanceId: 'auto1', instanceExplicit: false},
        {instanceId: 'auto2', instanceExplicit: false}
      )
    ).toBe(true)
  })

  it('warns when only one side asked for an instance', () => {
    expect(
      shouldWarnDevOverDev(
        {pid: 1, runId: 'r', instanceId: 'alpha', instanceExplicit: true},
        {instanceId: 'auto2', instanceExplicit: false}
      )
    ).toBe(true)
    expect(
      shouldWarnDevOverDev(
        {pid: 1, runId: 'r', instanceId: 'auto1', instanceExplicit: false},
        {instanceId: 'beta', instanceExplicit: true}
      )
    ).toBe(true)
  })

  it('stays silent when both asked for distinct instances', () => {
    expect(
      shouldWarnDevOverDev(
        {pid: 1, runId: 'r', instanceId: 'alpha', instanceExplicit: true},
        {instanceId: 'beta', instanceExplicit: true}
      )
    ).toBe(false)
  })

  it('warns when both asked for the same instance', () => {
    expect(
      shouldWarnDevOverDev(
        {pid: 1, runId: 'r', instanceId: 'alpha', instanceExplicit: true},
        {instanceId: 'alpha', instanceExplicit: true}
      )
    ).toBe(true)
  })
})

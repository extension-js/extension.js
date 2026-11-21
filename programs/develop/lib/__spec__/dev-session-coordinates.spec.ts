import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {devSessionCoordinates} from '../dev-session-coordinates'

const session = {
  protocol: 'ws',
  host: '0.0.0.0',
  connectableHost: '127.0.0.1',
  port: 8080,
  path: '/ws/one',
  instanceId: 'one',
  controlPort: 9000,
  launchEnabled: true
}

describe('the coordinates of a dev session', () => {
  it('are one record nothing can change after the session wrote it', () => {
    const record = devSessionCoordinates(session)

    expect(record).toEqual(session)
    expect(Object.isFrozen(record)).toBe(true)
    expect(() => {
      ;(record as {port: number}).port = 9999
    }).toThrow(TypeError)
  })

  it('say null for a control port that is no port', () => {
    for (const controlPort of [null, 0, -1, Number.NaN]) {
      expect(
        devSessionCoordinates({...session, controlPort}).controlPort
      ).toBeNull()
    }
  })

  it('belong to one session each, so a second record leaves the first as it was', () => {
    const first = devSessionCoordinates(session)
    const second = devSessionCoordinates({
      ...session,
      port: 8081,
      path: '/ws/two',
      instanceId: 'two',
      controlPort: null,
      launchEnabled: false
    })

    expect(first).toEqual(session)
    expect(second.path).toBe('/ws/two')
    expect(second.launchEnabled).toBe(false)
  })

  // The config a session builds takes the record and nothing beside it, so
  // no plugin can be handed a host, port or id that disagrees with it.
  it('are the only way a config learns where its session listens', () => {
    const develop = path.resolve(__dirname, '..', '..')
    const config = fs.readFileSync(
      path.join(develop, 'rspack-config.ts'),
      'utf8'
    )
    const types = fs.readFileSync(path.join(develop, 'types.ts'), 'utf8')
    const options = types.slice(
      types.indexOf('export interface CommonWebpackOptions'),
      types.indexOf('controlPortUnavailableReason')
    )

    expect(
      config.match(/devOptions\.(?:instanceId|controlPort|connectableHost)\b/g)
    ).toBeNull()

    expect(
      options.match(/^ {2}(?:instanceId|controlPort|connectableHost)\?:/gm)
    ).toBeNull()

    expect(options).toContain('session?: Readonly<DevSessionCoordinates>')
  })
})

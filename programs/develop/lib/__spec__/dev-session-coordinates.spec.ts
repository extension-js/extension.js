import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {CompilationPlugin} from '../../plugin-compilation'
import {ReadyContractPlugin} from '../../plugin-ready-contract'
import {ReloadPlugin} from '../../plugin-reload'
import {buildDevProducerSource} from '../../plugin-reload/reload-lib/producer-reload'
import type {PluginInterface} from '../../types'
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

  // A plugin takes the same record. A host, a port or an id handed beside it
  // could disagree with it, so the option types have no such field.
  it('are the only way a plugin learns them too', () => {
    const develop = path.resolve(__dirname, '..', '..')
    const types = fs
      .readFileSync(path.join(develop, 'types.ts'), 'utf8')
      .replace(/\r\n/g, '\n')
    const start = types.indexOf('export type PluginInterface = {')
    const plugin = types.slice(start, types.indexOf('\n}\n', start))

    expect(start).toBeGreaterThan(-1)
    expect(plugin).toContain('session?: Readonly<DevSessionCoordinates>')
    expect(plugin.match(/^ {2}(?:connectableHost|port)\?:/gm)).toBeNull()

    const loose = [
      'plugin-reload/index.ts',
      'plugin-reload/steps/inject-bridge-producer.ts',
      'plugin-reload/steps/inject-bridge-relay.ts',
      'plugin-reload/steps/setup-page-reload.ts',
      'plugin-reload/steps/apply-dev-defaults.ts',
      'plugin-web-extension/index.ts',
      'plugin-web-extension/feature-manifest/index.ts'
    ].filter((file) =>
      /options\.(?:instanceId|controlPort|connectableHost|port)\b|BridgeCoordinates/.test(
        fs.readFileSync(path.join(develop, file), 'utf8')
      )
    )

    expect(loose).toEqual([])
  })

  it('cannot be handed to a plugin as loose values', () => {
    // Never called: the compiler is what refuses each of these.
    const loose = () => {
      // @ts-expect-error a plugin is handed the session record, not a host
      const host: PluginInterface = {manifestPath: 'm', connectableHost: 'h'}
      // @ts-expect-error a plugin is handed the session record, not a port
      const port: PluginInterface = {manifestPath: 'm', port: 8080}

      // @ts-expect-error the reload plugin reads its bridge from the record
      new ReloadPlugin({manifestPath: 'm', instanceId: 'one'})
      // @ts-expect-error the producer is built for a session, not loose values
      buildDevProducerSource({controlPort: 9000, instanceId: 'one'})

      new ReadyContractPlugin({
        packageJsonDir: 'p',
        outputPath: 'o',
        manifestPath: 'm',
        // @ts-expect-error the ready contract names the session it was handed
        port: 8080
      })

      // @ts-expect-error the compilation plugin reads the port off the record
      new CompilationPlugin({manifestPath: 'm', port: 8080})

      return [host, port]
    }

    expect(typeof loose).toBe('function')
  })

  it('leave the config builder as the record, never as values read off it', () => {
    const config = fs
      .readFileSync(
        path.resolve(__dirname, '..', '..', 'rspack-config.ts'),
        'utf8'
      )
      .replace(/\r\n/g, '\n')

    expect(
      config.match(
        /session\?\.(?:port|host|connectableHost|instanceId|controlPort)\b|devOptions\.port\b/g
      )
    ).toBeNull()
  })
})

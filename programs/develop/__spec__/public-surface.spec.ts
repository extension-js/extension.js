import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import * as bridge from '../bridge-entry'

// Everything a host can only get by reading this package's internals is a
// capability the CLI has and a library caller does not. These pin the ones
// that were reachable from `extension <command>` and nowhere else.

const developRoot = path.resolve(__dirname, '..')

function source(relative: string): string {
  return fs.readFileSync(path.join(developRoot, relative), 'utf8')
}

describe('the extension-develop entry (module.ts)', () => {
  const moduleSource = source('module.ts')

  it('names the type extensionBuild resolves to', () => {
    expect(
      moduleSource,
      'extensionBuild returns a BuildSummary; without this export a TypeScript ' +
        'caller cannot name its own result.'
    ).toContain('type BuildSummary')
  })

  it('exports the Safari packaging contract a caller has to satisfy', () => {
    for (const name of [
      'type SafariPackagerFn',
      'type SafariPackagerOverrides',
      'type SafariPackageSummary'
    ]) {
      expect(
        moduleSource,
        `${name} is part of the injected-packager contract; develop packages ` +
          'nothing for safari unless the caller supplies safariPackager.'
      ).toContain(name)
    }
  })

  it('exports the option and config types the commands accept', () => {
    for (const name of [
      'type BrowserType',
      'type BrowserConfig',
      'type CompanionExtensionsConfig',
      'type StartOptions'
    ]) {
      expect(moduleSource).toContain(name)
    }
  })
})

describe('DevOptions declares the control-channel switches', () => {
  const typesSource = source('types.ts')

  it('declares allowControl and allowEval', () => {
    // The dev server has always read these off DevOptions, but they lived in a
    // local widening cast, so a typed caller could not pass them at all and the
    // whole agent bridge was reachable only through `--allow-control`.
    const devOptions = typesSource.slice(
      typesSource.indexOf('export interface DevOptions'),
      typesSource.indexOf('export interface BuildOptions')
    )
    expect(devOptions).toMatch(/\ballowControl\?: boolean/)
    expect(devOptions).toMatch(/\ballowEval\?: boolean/)
  })

  it('no longer hides them in the dev-server widening cast', () => {
    const devServer = source('dev-server/index.ts')
    const cast = devServer.slice(
      devServer.indexOf('const extendedOptions = devOptions as DevOptions & {'),
      devServer.indexOf('process.env.EXTENSION_BROWSER_LAUNCH_ENABLED')
    )
    expect(cast).not.toMatch(/allowControl\?: boolean/)
    expect(cast).not.toMatch(/allowEval\?: boolean/)
  })
})

describe('the extension-develop/bridge entry', () => {
  it('publishes the session-state layout instead of implying it', () => {
    // Consumers were rebuilding `dist/extension-js/<browser>/ready.json` by
    // hand, which silently reads nothing the day the layout moves.
    for (const name of [
      'readyContractPath',
      'logsPath',
      'eventsPath',
      'actionsPath',
      'buildSummaryPath',
      'browserArtifactsDir',
      'browserDistDir',
      'browserProfileRootDir',
      'sessionArtifactsRootDir',
      'sessionStateDir',
      'resolveSessionProjectRoot'
    ]) {
      expect(
        typeof (bridge as Record<string, unknown>)[name],
        `extension-develop/bridge must export ${name}.`
      ).toBe('function')
    }
  })

  it('agrees with the paths the dev server actually writes', () => {
    // path.resolve mirrors session-paths, which adds the drive on Windows.
    expect(bridge.readyContractPath('/p', 'chromium')).toBe(
      path.resolve('/p', 'dist', 'extension-js', 'chromium', 'ready.json')
    )
    expect(bridge.logsPath('/p', 'chromium')).toBe(
      path.resolve('/p', 'dist', 'extension-js', 'chromium', 'logs.ndjson')
    )
    expect(bridge.browserProfileRootDir('/p', 'chromium')).toBe(
      path.resolve('/p', 'dist', 'extension-js', 'profiles', 'chromium-profile')
    )
    expect(bridge.browserDistDir('/p', 'chromium')).toBe(
      path.resolve('/p', 'dist', 'chromium')
    )
  })

  it('agrees with the profile root the browser launchers actually build', () => {
    const launcherConfigs = [
      path.join(
        developRoot,
        '..',
        'extension',
        'browsers',
        'run-chromium',
        'chromium-launch',
        'browser-config.ts'
      ),
      path.join(
        developRoot,
        '..',
        'extension',
        'browsers',
        'run-firefox',
        'firefox-launch',
        'browser-config.ts'
      )
    ]
    for (const configPath of launcherConfigs) {
      const flat = fs.readFileSync(configPath, 'utf8').replace(/\s+/g, ' ')
      expect(flat, configPath).toContain("'extension-js', 'profiles'")
      expect(flat, configPath).toContain('-profile')
    }
  })

  it('publishes the whole-document ready reader beside the narrow one', () => {
    expect(typeof bridge.readReadyContractDocument).toBe('function')
  })

  it('exports the ready contract type the writer maintains', () => {
    const bridgeSource = source('bridge-entry.ts')
    for (const name of [
      'ReadyMetadata',
      'ReadyStatus',
      'ReadyContractDocument'
    ]) {
      expect(
        bridgeSource,
        `extension-develop/bridge must export ${name}.`
      ).toContain(name)
    }
  })

  it('publishes the control-channel wire constants', () => {
    expect(bridge.CONTROL_WS_PATH).toBe('/extjs-control')
    expect(bridge.CONTROL_ENVELOPE_VERSION).toBe(1)
    expect(bridge.LOG_EVENT_VERSION).toBe(1)
  })

  it('publishes the log query helpers `extension logs` selects with', () => {
    expect(typeof bridge.matchesLogQuery).toBe('function')
    expect(typeof bridge.readLogEvents).toBe('function')
  })

  it('publishes the level ranking, not just the yes/no filter', () => {
    // matchesLogQuery answers one event against one whole query. Sorting a
    // batch, or naming its worst level, is a different question, and a
    // consumer that cannot ask it re-invents the order and gets 'log' wrong.
    expect(typeof bridge.logLevelRank).toBe('function')
    expect(bridge.LOG_LEVEL_ORDER).toEqual([
      'error',
      'warn',
      'info',
      'debug',
      'trace'
    ])
    expect(bridge.logLevelRank('error')).toBeLessThan(
      bridge.logLevelRank('trace')
    )
    // The console emits `log`; the filter vocabulary calls it `info`. That
    // aliasing is the engine's rule, not something to re-derive downstream.
    expect(bridge.logLevelRank('log')).toBe(bridge.logLevelRank('info'))
    expect(bridge.logLevelRank('not-a-level')).toBe(
      bridge.LOG_LEVEL_ORDER.length
    )
  })

  it('publishes the close codes the server refuses a hello with', () => {
    // Without these a client can only guess that "code >= 4000 was probably
    // deliberate", which reports a version refusal as an empty log read.
    expect(bridge.CLOSE_BAD_INSTANCE).toBe(4001)
    expect(bridge.CLOSE_BAD_HELLO).toBe(4002)
    expect(bridge.CLOSE_CONTROL_UNAVAILABLE).toBe(4003)
    expect(bridge.CLOSE_SLOW_CONSUMER).toBe(4008)
  })

  it('publishes the refusal codes the producer names a refusal with', () => {
    expect(bridge.REFUSAL_NEEDS_HEADED_WINDOW).toBe('needs_headed_window')
    expect(bridge.REFUSAL_NEEDS_USER_GESTURE).toBe('needs_user_gesture')
    expect(bridge.REFUSAL_SURFACE_NOT_OPEN).toBe('surface_not_open')
    expect(bridge.REFUSAL_API_UNAVAILABLE).toBe('api_unavailable')

    const producerSource = source(
      'dev-server/control-bridge/producer-runtime.ts'
    )
    for (const code of [
      bridge.REFUSAL_NEEDS_HEADED_WINDOW,
      bridge.REFUSAL_NEEDS_USER_GESTURE,
      bridge.REFUSAL_SURFACE_NOT_OPEN,
      bridge.REFUSAL_API_UNAVAILABLE
    ]) {
      expect(producerSource, `the producer never sends ${code}`).toContain(
        `"${code}"`
      )
    }
  })

  it('publishes the same close codes the broker actually closes with', () => {
    // A published constant that drifts from the number on the wire is worse
    // than no constant at all, so the two are compared, never assumed equal.
    const brokerSource = source('dev-server/control-bridge/broker.ts')
    const serverSource = source(
      'dev-server/control-bridge/ws-control-server.ts'
    )
    for (const name of [
      'CLOSE_BAD_INSTANCE',
      'CLOSE_BAD_HELLO',
      'CLOSE_CONTROL_UNAVAILABLE'
    ]) {
      expect(brokerSource, `${name} is no longer used by the broker`).toContain(
        `conn.close(${name}`
      )
    }
    expect(serverSource).toContain('socket.close(CLOSE_SLOW_CONSUMER')
    expect(serverSource).not.toMatch(/const CLOSE_SLOW_CONSUMER = \d/)
  })
})

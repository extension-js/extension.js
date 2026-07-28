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
      'sessionArtifactsRootDir',
      'sessionStateDir'
    ]) {
      expect(
        typeof (bridge as Record<string, unknown>)[name],
        `extension-develop/bridge must export ${name}.`
      ).toBe('function')
    }
  })

  it('agrees with the paths the dev server actually writes', () => {
    expect(bridge.readyContractPath('/p', 'chromium')).toBe(
      path.join('/p', 'dist', 'extension-js', 'chromium', 'ready.json')
    )
    expect(bridge.logsPath('/p', 'chromium')).toBe(
      path.join('/p', 'dist', 'extension-js', 'chromium', 'logs.ndjson')
    )
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
})

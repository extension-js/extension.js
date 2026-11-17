import * as fs from 'node:fs'
import * as path from 'node:path'
import {expect} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  createTelemetryKit,
  Telemetry,
  type TelemetryDeps,
  type TelemetryEnv,
  type TelemetryFs
} from '../telemetry'
import {
  createTelemetryCli,
  type TelemetryCliDeps,
  type TelemetryHost
} from '../telemetry-cli'

export type SentRow = {
  event: string
  properties: Record<string, unknown>
  distinct_id: string
}

export type SentBatch = {url: string; apiKey: string; rows: SentRow[]}

export type CrashSend = {
  url: string
  apiKey: string
  rows: SentRow[]
  timeoutMs: number
  budgetMs: number
}

export const START = Date.parse('2026-11-17T12:00:00.000Z')

// A file where a folder belongs fails on every platform and as root.
export function blockFolder(folder: string): string {
  fs.mkdirSync(path.dirname(folder), {recursive: true})
  fs.writeFileSync(folder, 'not a folder')

  return folder
}

// The real fs with one call replaced, so a spec can fail exactly that call.
export function fsWith(overrides: Partial<Record<keyof TelemetryFs, unknown>>) {
  return {...fs, ...overrides} as unknown as TelemetryFs
}

export function readRows(file: string): SentRow[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SentRow)
}

export interface SandboxOptions {
  env?: TelemetryEnv
  deps?: Partial<TelemetryDeps>
}

// Call once per spec file. Each sandbox owns a temp root that holds every
// folder telemetry may touch, a fake clock, and fake senders that record.
export function useTelemetrySandbox() {
  const makeTempFolder = trackTempFolders()

  return function sandbox(options: SandboxOptions = {}) {
    const root = makeTempFolder('extjs-telemetry-')
    const places = {
      config: path.join(root, 'config'),
      cache: path.join(root, 'cache'),
      tmp: path.join(root, 'tmp'),
      project: path.join(root, 'project'),
      home: path.join(root, 'home')
    }

    for (const folder of [places.tmp, places.project, places.home]) {
      fs.mkdirSync(folder, {recursive: true})
    }

    const sent: SentBatch[] = []
    const crashSent: CrashSend[] = []
    const clock = {now: START}

    const deps: Partial<TelemetryDeps> = {
      env: {
        XDG_CONFIG_HOME: places.config,
        XDG_CACHE_HOME: places.cache,
        POSTHOG_HOST: 'http://127.0.0.1:9',
        ...options.env
      },
      platform: 'linux',
      homedir: () => places.home,
      tmpdir: () => places.tmp,
      cwd: () => places.project,
      now: () => clock.now,
      random: () => 0,
      stdoutIsTTY: () => false,
      send: async (url, init) => {
        const body = JSON.parse(init.body) as {
          api_key: string
          batch: SentRow[]
        }

        sent.push({url, apiKey: body.api_key, rows: body.batch})
      },
      sendSync: (request, budgetMs) => {
        const body = request.body as {api_key: string; batch: SentRow[]}

        crashSent.push({
          url: request.url,
          apiKey: body.api_key,
          rows: body.batch,
          timeoutMs: request.timeoutMs,
          budgetMs
        })

        return true
      },
      ...options.deps
    }

    const telemetryDir = (base: string) =>
      path.join(base, 'extensionjs', 'telemetry')

    return {
      root,
      places,
      deps,
      clock,
      sent,
      crashSent,
      configDir: telemetryDir(places.config),
      cacheDir: telemetryDir(places.cache),
      kit: () => createTelemetryKit(deps),
      telemetry: (init: Partial<ConstructorParameters<typeof Telemetry>[0]>) =>
        new Telemetry(
          {app: 'extension', version: '9.9.9', ...init},
          createTelemetryKit(deps)
        ),
      sentRows: () => sent.flatMap((batch) => batch.rows),
      // Nothing outside the sandbox root may be named by a resolved path.
      expectInside(file: string | null | undefined) {
        expect(String(file).startsWith(root + path.sep)).toBe(true)
      }
    }
  }
}

export type Sandbox = ReturnType<ReturnType<typeof useTelemetrySandbox>>

export function fakeHost(
  options: {exitCode?: number | string; uncaughtListeners?: number} = {}
) {
  const hooks: Record<string, Array<() => unknown>> = {}
  const host: TelemetryHost & {state: typeof options} = {
    state: {
      exitCode: options.exitCode,
      uncaughtListeners: options.uncaughtListeners
    },
    on(event, listener) {
      hooks[event] ??= []
      hooks[event].push(listener)
    },
    listenerCount: () => host.state.uncaughtListeners ?? 0,
    exitCode: () => host.state.exitCode
  }

  return {host, hooks}
}

// One CLI run on the sandbox: no install outcome unless a spec names one.
export function cliRun(
  box: Sandbox,
  overrides: Partial<TelemetryCliDeps> = {}
) {
  const notices: string[] = []
  const {host, hooks} = fakeHost()
  const cli = createTelemetryCli({
    ...box.deps,
    argv: ['node', 'extension', 'dev'],
    version: '9.9.9',
    readBrowserInstall: () => null,
    readDependencyInstall: () => null,
    printNotice: (line) => notices.push(line),
    host,
    ...overrides
  })

  return {cli, notices, host, hooks}
}

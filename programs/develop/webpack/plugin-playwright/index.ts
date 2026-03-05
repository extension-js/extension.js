// ██████╗ ██╗      █████╗ ██╗   ██╗██╗    ██╗██████╗ ██╗ ██████╗ ██╗  ██╗████████╗
// ██╔══██╗██║     ██╔══██╗╚██╗ ██╔╝██║    ██║██╔══██╗██║██╔════╝ ██║  ██║╚══██╔══╝
// ██████╔╝██║     ███████║ ╚████╔╝ ██║ █╗ ██║██████╔╝██║██║  ███╗███████║   ██║
// ██╔═══╝ ██║     ██╔══██║  ╚██╔╝  ██║███╗██║██╔══██╗██║██║   ██║██╔══██║   ██║
// ██║     ███████╗██║  ██║   ██║   ╚███╔███╔╝██║  ██║██║╚██████╔╝██║  ██║   ██║
// ╚═╝     ╚══════╝╚═╝  ╚═╝   ╚═╝    ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {type Compiler} from '@rspack/core'
import {asAbsolute, type AbsolutePath} from '../webpack-lib/paths'

export type PlaywrightAutomationCommand = 'dev' | 'start' | 'preview'
export type ReadyStatus = 'starting' | 'ready' | 'error'

export type ReadyMetadata = {
  status: ReadyStatus
  command: PlaywrightAutomationCommand
  browser: string
  runId: string
  startedAt: string
  distPath: string
  manifestPath: string
  port: number | null
  pid: number
  ts: string
  compiledAt: string | null
  errors: string[]
  code?: string
  message?: string
}

export type PlaywrightAutomationEvent = {
  type: 'compile_start' | 'compile_success' | 'compile_error' | 'shutdown'
  ts: string
  command: PlaywrightAutomationCommand
  browser: string
  durationMs?: number
  errorCount?: number
}

type WriterOptions = {
  packageJsonDir: string
  browser: string
  command: PlaywrightAutomationCommand
  distPath: string
  manifestPath: string
  port?: number | string | null
}

type PluginOptions = {
  packageJsonDir: string
  browser?: string
  mode?: 'development' | 'production' | 'none'
  outputPath: string
  manifestPath: string
  port?: number | string | null
  command?: PlaywrightAutomationCommand
}

function nowISO() {
  return new Date().toISOString()
}

function createRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function ensureDirSync(dirPath: string) {
  try {
    fs.mkdirSync(dirPath, {recursive: true})
  } catch {
    // best-effort only
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  try {
    const tmpPath = `${filePath}.tmp-${process.pid}`
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch {
    // best-effort only
  }
}

export function getPlaywrightMetadataDir(
  packageJsonDir: string,
  browser: string
): AbsolutePath {
  return asAbsolute(path.join(packageJsonDir, 'dist', 'extension-js', browser))
}

export function createPlaywrightMetadataWriter(options: WriterOptions) {
  const metadataDir = getPlaywrightMetadataDir(
    options.packageJsonDir,
    options.browser
  )
  const readyPath = asAbsolute(path.join(metadataDir, 'ready.json'))
  const eventsPath = asAbsolute(path.join(metadataDir, 'events.ndjson'))

  const base = {
    command: options.command,
    browser: options.browser,
    runId: createRunId(),
    startedAt: nowISO(),
    distPath: options.distPath,
    manifestPath: options.manifestPath,
    port: (() => {
      if (typeof options.port === 'number' && Number.isFinite(options.port)) {
        return options.port
      }
      if (typeof options.port === 'string') {
        const parsed = parseInt(options.port, 10)
        return Number.isFinite(parsed) ? parsed : null
      }
      return null
    })()
  }

  function writeReady(
    status: ReadyStatus,
    extra?: {
      compiledAt?: string | null
      errors?: string[]
      code?: string
      message?: string
    }
  ) {
    ensureDirSync(metadataDir)
    const payload: ReadyMetadata = {
      ...base,
      status,
      pid: process.pid,
      ts: nowISO(),
      compiledAt: extra?.compiledAt ?? null,
      errors: Array.isArray(extra?.errors) ? extra.errors : []
    }
    if (extra?.code) payload.code = extra.code
    if (extra?.message) payload.message = extra.message
    writeJsonAtomic(readyPath, payload)
  }

  function appendEvent(event: PlaywrightAutomationEvent) {
    ensureDirSync(metadataDir)
    try {
      fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf-8')
    } catch {
      // best-effort only
    }
  }

  return {
    metadataDir,
    readyPath,
    eventsPath,
    writeStarting() {
      writeReady('starting')
    },
    writeReady(compiledAt?: string | null) {
      writeReady('ready', {compiledAt: compiledAt || nowISO()})
    },
    writeError(code: string, message: string, errors?: string[]) {
      writeReady('error', {
        code,
        message,
        errors: Array.isArray(errors) ? errors : [],
        compiledAt: null
      })
    },
    appendEvent
  }
}

export class PlaywrightPlugin {
  public static readonly name = 'plugin-playwright'
  private readonly writer: ReturnType<typeof createPlaywrightMetadataWriter>
  private readonly command: PlaywrightAutomationCommand
  private readonly browser: string

  constructor(options: PluginOptions) {
    this.browser = String(options.browser || 'chromium')
    this.command =
      options.command || (options.mode === 'development' ? 'dev' : 'start')
    this.writer = createPlaywrightMetadataWriter({
      packageJsonDir: options.packageJsonDir,
      browser: this.browser,
      command: this.command,
      distPath: options.outputPath,
      manifestPath: options.manifestPath,
      port: options.port
    })
  }

  apply(compiler: Compiler) {
    this.writer.writeStarting()

    compiler.hooks.compile.tap(PlaywrightPlugin.name, () => {
      this.writer.appendEvent({
        type: 'compile_start',
        ts: nowISO(),
        command: this.command,
        browser: this.browser
      })
    })

    compiler.hooks.done.tap(PlaywrightPlugin.name, (stats: any) => {
      const durationMs = Number(
        (stats?.compilation?.endTime || 0) -
          (stats?.compilation?.startTime || 0)
      )
      const hasErrors = Boolean(stats?.hasErrors?.())
      const errorsCount = Number(
        Array.isArray(stats?.toJson?.({all: false, errors: true})?.errors)
          ? stats.toJson({all: false, errors: true}).errors.length
          : 0
      )

      if (hasErrors) {
        this.writer.appendEvent({
          type: 'compile_error',
          ts: nowISO(),
          command: this.command,
          browser: this.browser,
          durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
          errorCount: Number.isFinite(errorsCount) ? errorsCount : 1
        })
        this.writer.writeError('compile_error', 'Compilation failed', [
          `errors: ${String(errorsCount || 1)}`
        ])
        return
      }

      this.writer.appendEvent({
        type: 'compile_success',
        ts: nowISO(),
        command: this.command,
        browser: this.browser,
        durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
        errorCount: 0
      })
      this.writer.writeReady(nowISO())
    })

    compiler.hooks.failed.tap(PlaywrightPlugin.name, (error: unknown) => {
      this.writer.appendEvent({
        type: 'compile_error',
        ts: nowISO(),
        command: this.command,
        browser: this.browser,
        errorCount: 1
      })
      this.writer.writeError(
        'compile_failed',
        error instanceof Error ? error.message : String(error)
      )
    })

    compiler.hooks.watchClose.tap(PlaywrightPlugin.name, () => {
      this.writer.appendEvent({
        type: 'shutdown',
        ts: nowISO(),
        command: this.command,
        browser: this.browser
      })
    })
  }
}

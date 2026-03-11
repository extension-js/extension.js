//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import fs from 'fs'
import path from 'path'
import {Telemetry} from './telemetry'
import {getCliPackageJson} from '../cli-package-json'
import {summarizeManifest} from './manifest-summary'
import {collectProjectProfile} from './project-profile'

// Initialize telemetry singleton for CLI
// Opt-out is controlled via CLI flag only: --no-telemetry
function isTelemetryDisabledFromArgs(argv: string[]): boolean {
  return argv.includes('--no-telemetry')
}

const telemetryDisabled = isTelemetryDisabledFromArgs(process.argv)

type KnownCommand =
  | 'create'
  | 'dev'
  | 'start'
  | 'preview'
  | 'build'
  | 'install'
  | 'uninstall'
  | 'cleanup'
  | 'unknown'

function findManifestJson(projectRoot: string): string | null {
  // Best-effort: match project detection behavior (manifest may live under src/).
  // Avoid expensive/unsafe traversals.
  const stack: string[] = [projectRoot]

  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue

    let entries: fs.Dirent[]

    try {
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'manifest.json') {
        return path.join(dir, entry.name)
      }

      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== 'node_modules' &&
        entry.name !== 'dist'
      ) {
        stack.push(path.join(dir, entry.name))
      }
    }
  }

  return null
}

export const telemetry = new Telemetry({
  app: 'extension',
  version: getCliPackageJson().version,
  disabled: telemetryDisabled
})

export function detectInvokedCommand(argv: string[]): KnownCommand {
  const known = new Set<KnownCommand>([
    'create',
    'dev',
    'start',
    'preview',
    'build',
    'install',
    'uninstall',
    'cleanup',
    'unknown'
  ])

  return (argv
    .slice(2)
    .find((a): a is KnownCommand => known.has(a as KnownCommand)) ||
    'unknown') as KnownCommand
}

if (!telemetryDisabled) {
  const startedAt = Date.now()

  let shutdownTracked = false

  const invoked = detectInvokedCommand(process.argv)

  telemetry.track('cli_boot', {
    command_guess: invoked
  })

  // Attempt to emit a one-time, privacy-safe manifest summary when present
  const manifestPath = findManifestJson(process.cwd())
  let manifestSummary: ReturnType<typeof summarizeManifest> | null = null

  if (manifestPath) {
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8')
      const json = JSON.parse(raw)
      manifestSummary = summarizeManifest(json)
      telemetry.track('manifest_summary', manifestSummary)
    } catch {
      // Best-effort only: telemetry must never make project parsing stricter.
    }
  }

  const projectProfile = collectProjectProfile(process.cwd(), manifestSummary)

  if (projectProfile) {
    telemetry.track('project_profile', projectProfile)
  }

  process.on('beforeExit', async function () {
    if (shutdownTracked) return

    shutdownTracked = true

    telemetry.track('cli_shutdown', {
      command_guess: invoked,
      duration_ms: Date.now() - startedAt,
      exit_code: process.exitCode ?? 0
    })
    await telemetry.flush()
  })

  process.on('uncaughtException', function (err) {
    telemetry.track('cli_error', {
      command_guess: invoked,
      error_name: String((err as any)?.name || 'Error').slice(0, 64)
    })
  })

  process.on('unhandledRejection', function (reason: any) {
    telemetry.track('cli_error', {
      command_guess: invoked,
      error_name: String(reason?.name || 'PromiseRejection').slice(0, 64)
    })
  })
}

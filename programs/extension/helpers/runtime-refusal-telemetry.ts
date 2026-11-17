//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {getCliPackageJson} from './cli-package-json'
import {KNOWN_COMMANDS, type KnownCommand} from './known-commands'
import {createTelemetryKit, Telemetry, type TelemetryDeps} from './telemetry'

const UNSUPPORTED_RUNTIME_FLUSH_MS = 1500

export function commandFromArgv(argv: string[]): string {
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--output') index += 1
    else if (!argv[index].startsWith('-')) return argv[index]
  }

  return 'extension'
}

// Only a machine whose owner already saw the first-run notice reports here,
// since this exit comes before the CLI that prints the notice can load.
export function reportUnsupportedRuntimeWith(
  argv: string[],
  deps: Partial<TelemetryDeps> & {version?: string} = {}
): void {
  try {
    const kit = createTelemetryKit(deps)
    const consent = kit.resolveConsent(argv)
    if (!consent.enabled || consent.source === 'default') return

    const verb = commandFromArgv(argv)
    const command: KnownCommand = KNOWN_COMMANDS.has(verb as KnownCommand)
      ? (verb as KnownCommand)
      : 'unknown'
    const version =
      deps.version ?? String(getCliPackageJson().version || '0.0.0')
    const telemetry = new Telemetry({app: 'extension', version}, kit)

    telemetry.track('command_failed', {
      command,
      success: false,
      version,
      code: 'E_NODE_VERSION',
      exit_code: 1
    })

    telemetry.flushSync(UNSUPPORTED_RUNTIME_FLUSH_MS)
  } catch {
    // Ignore
  }
}

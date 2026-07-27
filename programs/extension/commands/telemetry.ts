//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command} from 'commander'
import colors from 'pintor'
import {commandDescriptions} from '../helpers/messages'
import {
  getTelemetryConsent,
  setTelemetryConsent
} from '../helpers/telemetry-cli'

type TelemetryAction = 'enable' | 'disable' | 'status'

export function registerTelemetryCommand(program: Command) {
  program
    .command('telemetry')
    .argument('[action]', 'enable | disable | status (default: status)')
    .description(commandDescriptions.telemetry)
    .action((action?: string) => {
      const normalized = String(action || 'status')
        .trim()
        .toLowerCase() as TelemetryAction

      if (normalized === 'enable') {
        const {ok, path} = setTelemetryConsent('enabled')
        if (ok) {
          // eslint-disable-next-line no-console
          console.log(
            `${colors.green('✓')} Telemetry enabled${path ? ` (${path})` : ''}.`
          )
          process.exit(0)
        }
        // eslint-disable-next-line no-console
        console.error(
          `${colors.red('✗')} Could not write telemetry consent file.`
        )
        process.exit(1)
      }

      if (normalized === 'disable') {
        const {ok, path} = setTelemetryConsent('disabled')
        if (ok) {
          // eslint-disable-next-line no-console
          console.log(
            `${colors.green('✓')} Telemetry disabled${path ? ` (${path})` : ''}.`
          )
          process.exit(0)
        }
        // eslint-disable-next-line no-console
        console.error(
          `${colors.red('✗')} Could not write telemetry consent file.`
        )
        process.exit(1)
      }

      if (normalized === 'status') {
        const {enabled, source} = getTelemetryConsent()
        const label = enabled ? colors.green('enabled') : colors.red('disabled')
        // eslint-disable-next-line no-console
        console.log(`Telemetry: ${label} (source: ${source})`)
        process.exit(0)
      }

      // eslint-disable-next-line no-console
      console.error(
        `Unknown telemetry action: ${action}. Expected: enable | disable | status.`
      )
      process.exit(1)
    })
}

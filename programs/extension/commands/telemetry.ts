//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command} from 'commander'
import colors from 'pintor'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE} from '../helpers/messaging'
import {isJsonOutput} from '../helpers/output-flag'
import {
  getTelemetryConsent,
  setTelemetryConsent
} from '../helpers/telemetry-cli'

type TelemetryAction = 'enable' | 'disable' | 'status'

type TelemetryOptions = {
  output?: 'pretty' | 'json'
}

export function registerTelemetryCommand(program: Command) {
  program
    .command('telemetry')
    .argument('[action]', 'enable | disable | status (default: status)')
    .description(commandDescriptions.telemetry)
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .action(async (action: string | undefined, opts: TelemetryOptions = {}) => {
      const normalized = String(action || 'status')
        .trim()
        .toLowerCase() as TelemetryAction
      const asJson = isJsonOutput(opts)

      const emit = (frame: unknown) => {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(frame))
      }

      if (normalized === 'enable' || normalized === 'disable') {
        const enabling = normalized === 'enable'
        const {ok, path} = setTelemetryConsent(
          enabling ? 'enabled' : 'disabled'
        )

        if (ok) {
          if (asJson) {
            emit(
              ENVELOPE.ok('telemetry', 'status', {
                enabled: enabling,
                source: 'config',
                path
              })
            )
          } else {
            // eslint-disable-next-line no-console
            console.log(
              `${colors.green('✓')} Telemetry ${enabling ? 'enabled' : 'disabled'}${path ? ` (${path})` : ''}.`
            )
          }
          await exitAfterDrain(0)
          return
        }

        if (asJson) {
          emit(
            ENVELOPE.fail(
              'telemetry',
              'failed',
              {
                code: CODES.E_TELEMETRY_WRITE,
                message: 'Could not write telemetry consent file.'
              },
              {hint: 'Check write permissions on the consent file path.'}
            )
          )
        } else {
          // eslint-disable-next-line no-console
          console.error(
            `${colors.red('✗')} Could not write telemetry consent file.`
          )
        }
        await exitAfterDrain(1)
        return
      }

      if (normalized === 'status') {
        const {enabled, source} = getTelemetryConsent()
        if (asJson) {
          emit(ENVELOPE.ok('telemetry', 'status', {enabled, source}))
        } else {
          const label = enabled
            ? colors.green('enabled')
            : colors.red('disabled')
          // eslint-disable-next-line no-console
          console.log(`Telemetry: ${label} (source: ${source})`)
        }
        await exitAfterDrain(0)
        return
      }

      if (asJson) {
        emit(
          ENVELOPE.fail(
            'telemetry',
            'usage',
            {
              code: CODES.E_ARGS,
              message: `Unknown telemetry action: ${action}.`
            },
            {hint: 'Expected: enable | disable | status.'}
          )
        )
      } else {
        // eslint-disable-next-line no-console
        console.error(
          `Unknown telemetry action: ${action}. Expected: enable | disable | status.`
        )
      }
      await exitAfterDrain(1)
    })
}

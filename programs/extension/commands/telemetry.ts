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
import {commandDescriptions, usageRefusal} from '../helpers/messages'
import {CODES, ENVELOPE} from '../helpers/messaging'
import {isJsonOutput, refuseUnreadableOutput} from '../helpers/output-flag'
import {
  getTelemetryStatus,
  resetTelemetry,
  setTelemetryConsent
} from '../helpers/telemetry-cli'

type TelemetryAction = 'enable' | 'disable' | 'status' | 'reset'

type TelemetryOptions = {
  output?: 'pretty' | 'json'
}

// The three calls the action makes outside this file.
interface TelemetryCommandDeps {
  getStatus?: typeof getTelemetryStatus
  setConsent?: typeof setTelemetryConsent
  reset?: typeof resetTelemetry
}

export function registerTelemetryCommand(
  program: Command,
  {
    getStatus = getTelemetryStatus,
    setConsent = setTelemetryConsent,
    reset = resetTelemetry
  }: TelemetryCommandDeps = {}
) {
  program
    .command('telemetry')
    .argument('[action]', 'enable | disable | status | reset (default: status)')
    .description(commandDescriptions.telemetry)
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .hook('preAction', refuseUnreadableOutput())
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
        const {ok, path} = setConsent(enabling ? 'enabled' : 'disabled')

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
            usageRefusal(
              'Could not write telemetry consent file.\n' +
                (path ? `PATH ${path}\n` : '') +
                'Check write permissions on the consent file path.'
            )
          )
        }

        await exitAfterDrain(1)

        return
      }

      if (normalized === 'status') {
        const status = getStatus()

        if (asJson) {
          emit(ENVELOPE.ok('telemetry', 'status', status))
        } else {
          const label = status.enabled
            ? colors.green('enabled')
            : colors.red('disabled')
          const decidedBy = status.variable
            ? `${status.source}, ${status.variable}`
            : status.source
          // eslint-disable-next-line no-console
          console.log(
            [
              `Telemetry: ${label} (source: ${decidedBy})`,
              `Anonymous ID: ${status.anonymousId ?? 'none'}`,
              `Consent file: ${status.consentFile ?? 'none'}`,
              `Audit log: ${status.auditFile ?? 'none'}`
            ].join('\n')
          )
        }

        await exitAfterDrain(0)

        return
      }

      if (normalized === 'reset') {
        const {ok, removed, clearedOptOut} = reset()

        if (ok) {
          if (asJson) {
            emit(ENVELOPE.ok('telemetry', 'reset', {removed, clearedOptOut}))
          } else {
            const lines = [
              removed.length > 0
                ? `${colors.green('✓')} Telemetry reset. Removed the anonymous ID, the consent and the local audit log. The next run starts fresh and shows the first-run notice.`
                : `${colors.green('✓')} Telemetry reset. Nothing was stored.`
            ]

            if (clearedOptOut) {
              lines.push(
                `A stored opt-out was removed too. Run ${colors.cyan('extension telemetry disable')} to keep telemetry off.`
              )
            }

            // eslint-disable-next-line no-console
            console.log(lines.join('\n'))
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
                message: 'Could not remove every telemetry file.'
              },
              {
                value: {removed, clearedOptOut},
                hint: 'Check write permissions on the telemetry folder.'
              }
            )
          )
        } else {
          // eslint-disable-next-line no-console
          console.error(
            usageRefusal(
              'Could not remove every telemetry file.\n' +
                'Check write permissions on the telemetry folder.'
            )
          )
        }

        await exitAfterDrain(1)

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
            {hint: 'Expected: enable | disable | status | reset.'}
          )
        )
      } else {
        // eslint-disable-next-line no-console
        console.error(
          usageRefusal(
            `Unknown telemetry action: ${action}.\n` +
              'Expected: enable | disable | status | reset.'
          )
        )
      }

      await exitAfterDrain(1)
    })
}

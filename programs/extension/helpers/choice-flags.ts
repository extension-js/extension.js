//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command, Option} from 'commander'
import {exitWithFailure} from './exit-after-drain'
import * as messages from './messages'
import {CODES, ENVELOPE} from './messaging'
import {normalizeOutputFormat} from './output-flag'
import type {reportCommandFailureNow} from './telemetry-cli'
import {SUPPORTED_BROWSER_TARGETS, unsupportedBrowserMessage} from './vendors'

// Not choice lists, or checked by a refusal of their own: --output and its
// alias have refuseUnreadableOutput, --browser names its targets per command,
// and --url and --since describe the shapes of an open value.
export const NOT_A_CLOSED_CHOICE = new Set([
  '--output',
  '--wait-format',
  '--browser',
  '--url',
  '--since'
])

// The choices a flag declares in its own `<a|b|c>`, so the refusal reads the
// same list the help prints and the two cannot drift apart.
export function declaredChoices(option: Option): string[] | undefined {
  if (!option.long || NOT_A_CLOSED_CHOICE.has(option.long)) return undefined

  const listed = /<([^<>\s|]+(?:\|[^<>\s|]+)+)>/.exec(option.flags)?.[1]

  return listed ? listed.split('|') : undefined
}

// The preAction hook of every command with a closed-choice flag. A value off
// the list is refused before the action, as --output is.
export function refuseUnlistedChoices({
  skip = [],
  hints = {},
  reportFailure
}: {
  skip?: readonly string[]
  hints?: Record<string, (value: string) => string>
  reportFailure?: typeof reportCommandFailureNow
} = {}): (command: Command, actionCommand: Command) => void {
  return (_command, actionCommand) => {
    const opts = actionCommand.opts()

    for (const option of actionCommand.options) {
      const choices = declaredChoices(option)
      if (!choices || skip.includes(String(option.long))) continue

      const value = opts[option.attributeName()]
      if (value === undefined) continue
      if (choices.includes(String(value).trim().toLowerCase())) continue

      const flag = String(option.long)
      const message = messages.invalidChoiceValue(flag, String(value), choices)
      const hint = hints[flag]?.(String(value))

      if (normalizeOutputFormat(opts.output) === 'json') {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            ENVELOPE.fail(
              actionCommand.name(),
              'usage',
              {code: CODES.E_INVALID_OPTION, message},
              hint ? {hint} : {}
            )
          )
        )
      } else {
        // eslint-disable-next-line no-console
        console.error(
          messages.usageRefusal(hint ? `${message}\n${hint}` : message)
        )
      }

      exitWithFailure(CODES.E_INVALID_OPTION, 1, reportFailure)
    }
  }
}

// The preAction hook of the commands that attach to a session. A session is
// named by the --browser dev was given, so the same names are taken here, read
// in any case, and anything else is refused before a session is looked for.
export function refuseUnknownSessionBrowser({
  framed = (opts) => normalizeOutputFormat(opts.output) === 'json'
}: {
  framed?: (opts: Record<string, unknown>) => boolean
} = {}): (command: Command, actionCommand: Command) => void {
  return (_command, actionCommand) => {
    const opts = actionCommand.opts()
    if (opts.browser === undefined) return

    const name = String(opts.browser).trim().toLowerCase()

    if (SUPPORTED_BROWSER_TARGETS.includes(name)) {
      actionCommand.setOptionValue('browser', name)

      return
    }

    const supported = [...SUPPORTED_BROWSER_TARGETS]

    if (framed(opts)) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          ENVELOPE.fail(actionCommand.name(), 'usage', {
            code: CODES.E_UNSUPPORTED_BROWSER,
            message: unsupportedBrowserMessage(name, supported)
          })
        )
      )
    } else {
      // eslint-disable-next-line no-console
      console.error(messages.unsupportedBrowserFlag(name, supported))
    }

    exitWithFailure(CODES.E_UNSUPPORTED_BROWSER, 1)
  }
}

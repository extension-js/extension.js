//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command} from 'commander'
import {getCliPackageJson} from '../helpers/cli-package-json'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {commandDescriptions} from '../helpers/messages'
import {ENVELOPE, ENVELOPE_SCHEMA} from '../helpers/messaging'

// ready.json's schemaVersion as this CLI's bundled engine writes it. A spec
// compares this against the writer's source, so the two cannot drift apart.
export const READY_CONTRACT_SCHEMA_VERSION = 2

interface OptionLike {
  long?: string
  flags?: string
}

interface CommandLike {
  name(): string
  options?: OptionLike[]
}

// Accepting --output json is not the same as terminating with one envelope.
// logs streams a record per event and frames only its failures, so it is
// named in both lists: it takes the flag, and it answers with records.
const RECORD_STREAM_COMMANDS = new Set(['logs'])

function acceptsOutputJson(command: CommandLike): boolean {
  return (command.options || []).some(
    (option) =>
      option.long === '--output' && String(option.flags || '').includes('json')
  )
}

// Read off the live registrations, never a hand-kept list, so a release that
// gives a command --output json can never leave this answer behind.
export function collectOutputJsonCommands(program: Command): string[] {
  const names = new Set<string>()

  for (const command of program.commands as unknown as CommandLike[]) {
    const name = command.name()

    if (acceptsOutputJson(command)) names.add(name)
  }

  return Array.from(names).sort()
}

export function collectRecordStreamCommands(program: Command): string[] {
  const names = new Set<string>()

  for (const command of program.commands as unknown as CommandLike[]) {
    const name = command.name()

    if (acceptsOutputJson(command) && RECORD_STREAM_COMMANDS.has(name)) {
      names.add(name)
    }
  }

  return Array.from(names).sort()
}

export interface EngineCapabilities {
  name: string
  version: string
  envelopeSchema: number
  readySchemaVersion: number
  outputJsonCommands: string[]
  recordStreamCommands: string[]
}

export function buildEngineCapabilities(program: Command): EngineCapabilities {
  const cliPackageJson = getCliPackageJson()

  return {
    name: String(cliPackageJson.name || 'extension'),
    version: String(cliPackageJson.version || ''),
    envelopeSchema: ENVELOPE_SCHEMA,
    readySchemaVersion: READY_CONTRACT_SCHEMA_VERSION,
    outputJsonCommands: collectOutputJsonCommands(program),
    recordStreamCommands: collectRecordStreamCommands(program)
  }
}

export function registerCapabilitiesCommand(program: Command): void {
  program
    .command('capabilities')
    .description(commandDescriptions.capabilities)
    .option(
      '--output <pretty|json>',
      'result format. This command defaults to json'
    )
    .action(async (opts: {output?: string} = {}) => {
      const format =
        String(opts.output ?? 'json')
          .trim()
          .toLowerCase() === 'pretty'
          ? 'pretty'
          : 'json'
      const value = buildEngineCapabilities(program)

      if (format === 'json') {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(ENVELOPE.ok('capabilities', 'ok', value)))
        await exitAfterDrain(0)

        return
      }

      // eslint-disable-next-line no-console
      console.log(
        [
          `${value.name} ${value.version}`,
          `envelope schema: ${value.envelopeSchema}`,
          `ready contract schemaVersion: ${value.readySchemaVersion}`,
          `commands that accept --output json: ${value.outputJsonCommands.join(', ')}`,
          `commands that stream records instead of one envelope: ${value.recordStreamCommands.join(', ')}`
        ].join('\n')
      )

      await exitAfterDrain(0)
    })
}

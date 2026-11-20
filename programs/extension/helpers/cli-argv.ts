//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command, Option} from 'commander'

export function scanArgvValue(
  argv: string[],
  flag: string
): string | undefined {
  const equalArg = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (equalArg) return equalArg.slice(flag.length + 1)

  const flagIndex = argv.indexOf(flag)
  if (flagIndex >= 0) return argv[flagIndex + 1] || ''

  return undefined
}

// Every long flag the program or one of its commands declares with a value,
// so the argv scan below can tell `--format json dev` apart from `json dev`.
export function collectValuedLongFlags(program: Command): Set<string> {
  const flags = new Set<string>()

  const visit = (command: Command) => {
    for (const option of command.options) {
      if (option.long && (option.required || option.optional)) {
        flags.add(option.long)
      }
    }

    for (const sub of command.commands) visit(sub)
  }

  visit(program)

  return flags
}

function resolveCommandIndex(
  argv: string[],
  valuedFlags: ReadonlySet<string>
): number {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg.startsWith('-')) {
      if (valuedFlags.has(arg)) i += 1

      continue
    }

    return i
  }

  return -1
}

// The command name is the first bare token that is not the value of a flag
// that takes one; commander decides the same way once it parses.
export function resolveCommandFromArgv(
  argv: string[],
  valuedFlags: ReadonlySet<string> = new Set()
): string | undefined {
  const index = resolveCommandIndex(argv, valuedFlags)

  return index < 0 ? undefined : argv[index]
}

export function findSubcommand(
  program: Command,
  name: string | undefined
): Command | undefined {
  if (!name) return undefined

  return program.commands.find(
    (command) => command.name() === name || command.aliases().includes(name)
  )
}

function findLongOption(command: Command, arg: string): Option | undefined {
  const name = arg.split('=')[0]

  return command.options.find((option) => option.long === name)
}

// A flag the command declares, typed in front of it, is read as that command's
// flag. Commander would refuse it at the root and send the reader to help.
export function moveCommandFlagsBehindCommand(
  argv: string[],
  program: Command,
  valuedFlags: ReadonlySet<string> = new Set()
): string[] {
  const commandIndex = resolveCommandIndex(argv, valuedFlags)
  const command = findSubcommand(program, argv[commandIndex])
  if (commandIndex < 0 || !command) return argv

  const moved: string[] = []
  const kept: string[] = argv.slice(0, 2)

  for (let i = 2; i < commandIndex; i += 1) {
    const arg = argv[i]
    const option = arg.startsWith('--')
      ? findLongOption(command, arg)
      : undefined

    if (!option || findLongOption(program, arg)) {
      kept.push(arg)

      continue
    }

    moved.push(arg)

    if (option.required && !arg.includes('=') && i + 1 < commandIndex) {
      moved.push(argv[i + 1])
      i += 1
    }
  }

  if (moved.length === 0) return argv

  return [
    ...kept,
    argv[commandIndex],
    ...moved,
    ...argv.slice(commandIndex + 1)
  ]
}

// A flag that needs a value, followed by another flag of the same command, has
// no value: commander would take the next flag as it and the run would go wrong.
export function findFlagMissingItsValue(
  argv: string[],
  program: Command,
  valuedFlags: ReadonlySet<string> = new Set()
): Option | undefined {
  const commandIndex = resolveCommandIndex(argv, valuedFlags)
  const command = findSubcommand(program, argv[commandIndex])
  if (commandIndex < 0 || !command) return undefined

  for (let i = commandIndex + 1; i < argv.length - 1; i += 1) {
    const arg = argv[i]
    if (arg === '--') return undefined
    if (!arg.startsWith('--') || arg.includes('=')) continue

    const option = findLongOption(command, arg)
    if (!option?.required) continue

    const next = argv[i + 1]
    if (next === '--help' || findLongOption(command, next)) return option

    i += 1
  }

  return undefined
}

// Only subcommands declare --output, so in front of the command commander
// refuses it. It moves behind the command, as its deprecated alias does.
export function movePreCommandOutputArgv(
  argv: string[],
  valuedFlags: ReadonlySet<string> = new Set()
): string[] {
  const commandIndex = resolveCommandIndex(argv, valuedFlags)
  if (commandIndex < 0) return argv

  const index = argv.findIndex(
    (arg, i) =>
      i >= 2 &&
      i < commandIndex &&
      (arg === '--output' || arg.startsWith('--output='))
  )
  if (index < 0) return argv

  const next = [...argv]
  const value = next[index + 1]
  const takesValue =
    next[index] === '--output' &&
    value !== undefined &&
    !value.startsWith('-') &&
    index + 1 < commandIndex
  const tokens = next.splice(index, takesValue ? 2 : 1)

  next.splice(commandIndex - tokens.length + 1, 0, ...tokens)

  return next
}

// --format is a deprecated alias of --output that only the root program
// declares. Rewriting it here keeps one code path for every command, and a
// pre-command alias moves behind the command so the subcommand parses it.
export function rewriteOutputAliasArgv(
  argv: string[],
  valuedFlags: ReadonlySet<string> = new Set()
): {argv: string[]; rewritten: boolean} {
  const index = argv.findIndex(
    (arg) => arg === '--format' || arg.startsWith('--format=')
  )
  if (index < 0) return {argv, rewritten: false}

  const next = [...argv]
  const tokens: string[] = []

  if (next[index].startsWith('--format=')) {
    tokens.push(`--output=${next[index].slice('--format='.length)}`)
    next.splice(index, 1)
  } else {
    tokens.push('--output')
    const value = next[index + 1]
    next.splice(index, value !== undefined && !value.startsWith('-') ? 2 : 1)
    if (value !== undefined && !value.startsWith('-')) tokens.push(value)
  }

  const command = resolveCommandFromArgv(next, valuedFlags)
  const commandIndex = command ? next.indexOf(command, 2) : -1

  if (commandIndex >= index) {
    next.splice(commandIndex + 1, 0, ...tokens)
  } else {
    next.splice(index, 0, ...tokens)
  }

  return {argv: next, rewritten: true}
}

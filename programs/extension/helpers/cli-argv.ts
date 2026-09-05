//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command} from 'commander'

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

// The command name is the first bare token that is not the value of a flag
// that takes one; commander decides the same way once it parses.
export function resolveCommandFromArgv(
  argv: string[],
  valuedFlags: ReadonlySet<string> = new Set()
): string | undefined {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('-')) {
      if (valuedFlags.has(arg)) i += 1
      continue
    }
    return arg
  }
  return undefined
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

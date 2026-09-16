//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command} from 'commander'

export function isExplicitCliOption(command: Command, name: string): boolean {
  return command.getOptionValueSource(name) === 'cli'
}

export function explicitCliValue<T>(
  command: Command,
  name: string,
  value: T
): T | undefined {
  return isExplicitCliOption(command, name) ? value : undefined
}

export function explicitOptionalBoolean(
  value: boolean | string | undefined
): boolean | undefined {
  if (typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  }

  return undefined
}

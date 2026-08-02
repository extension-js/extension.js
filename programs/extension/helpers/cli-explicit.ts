//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command} from 'commander'

/**
 * True when the user typed this option on the CLI (not a commander default).
 * Negated boolean options (`--no-open`, `--no-log-color`) set a default value
 * even when absent. Use this to leave those unset so extension.config.js
 * `commands.*` values can apply downstream.
 */
export function isExplicitCliOption(command: Command, name: string): boolean {
  return command.getOptionValueSource(name) === 'cli'
}

/**
 * Return `value` only when the user typed the flag, `undefined` otherwise,
 * so develop can fall through to extension.config.js and stock defaults.
 */
export function explicitCliValue<T>(
  command: Command,
  name: string,
  value: T
): T | undefined {
  return isExplicitCliOption(command, name) ? value : undefined
}

/**
 * Coerce an optional boolean CLI value without inventing a default. Commander
 * may leave the key unset, or set a boolean/string from `--flag`,
 * `--flag false`, or `--no-flag`.
 */
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

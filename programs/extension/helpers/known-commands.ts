//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export type KnownCommand =
  | 'build'
  | 'capabilities'
  | 'create'
  | 'dev'
  | 'doctor'
  | 'eval'
  | 'inspect'
  | 'install'
  | 'logs'
  | 'navigate'
  | 'open'
  | 'preview'
  | 'publish'
  | 'reload'
  | 'start'
  | 'storage'
  | 'telemetry'
  | 'uninstall'
  | 'unknown'

// Every command the CLI registers. An unlisted verb reports as 'unknown', which
// is what keeps a project path or a typo out of the payload, so the list has to
// stay complete or half the failures land under 'unknown'. A spec pins it to the
// registered commands.
export const KNOWN_COMMANDS: ReadonlySet<KnownCommand> = new Set([
  'build',
  'capabilities',
  'create',
  'dev',
  'doctor',
  'eval',
  'inspect',
  'install',
  'logs',
  'navigate',
  'open',
  'preview',
  'publish',
  'reload',
  'start',
  'storage',
  'telemetry',
  'uninstall',
  'unknown'
])

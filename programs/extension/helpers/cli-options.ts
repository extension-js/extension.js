//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {Option} from 'commander'

// Commander names the attribute after the last long flag of a declaration,
// so one two-spelling option silently landed on `firefoxBinary` while the
// commands read `geckoBinary`. Two options keep both spellings and one name.
export function geckoBinaryOption(): Option {
  return new Option(
    '--gecko-binary <path-to-binary>',
    'specify a path to the Gecko binary (alias: --firefox-binary). This option overrides the --browser setting. Defaults to the system default'
  )
}

export function firefoxBinaryAliasOption(): Option {
  return new Option('--firefox-binary <path-to-binary>').hideHelp()
}

export function cliGeckoBinary(opts: {
  geckoBinary?: string
  firefoxBinary?: string
}): string | undefined {
  return opts.geckoBinary ?? opts.firefoxBinary
}

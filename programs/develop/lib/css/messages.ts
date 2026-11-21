//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {type WithheldKind, withheldFileLines} from '../withheld-file'

// Under strict refs the reader already set the variable the hint names.
export function deadCssUrlRef(
  issuerPath: string,
  request: string,
  strict = false
) {
  return [
    `A ${colors.blue(`url(${request})`)} reference points to a file that exists nowhere in the project.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('NOT FOUND')} ${colors.underline(request)}`,
    `Chrome applies the rest of the stylesheet and 404s this reference silently, so it's likely dead code.`,
    ...(strict
      ? []
      : [
          `Set ${colors.blue('EXTENSION_STRICT_REFS=true')} to make this a build error.`
        ])
  ].join('\n')
}

// A file that is there and stays out, by a url() or an @import alike. Under
// strict refs the reader already set the variable the hint names.
export function withheldCssRef(
  issuerPath: string,
  request: string,
  kind: WithheldKind,
  strict = false,
  writtenIn?: string
) {
  return [
    ...withheldFileLines(request, kind, {
      check: `Check the ${colors.blue('url()')} or ${colors.blue('@import')} that names it in this stylesheet.`,
      holds: 'contents'
    }),
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    ...(writtenIn && writtenIn !== issuerPath
      ? [`${colors.gray('WRITTEN IN')} ${colors.underline(writtenIn)}`]
      : []),
    // No word here may be one the summary files a warning under.
    'The rest of the stylesheet ships, and this reference loads nothing.',
    ...(strict
      ? []
      : [
          `Set ${colors.blue('EXTENSION_STRICT_REFS=true')} to make this a build error.`
        ])
  ].join('\n')
}

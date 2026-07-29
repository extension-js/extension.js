// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../../../lib/messaging'

export function warFieldError(
  filePath: string,
  opts?: {
    overrideNotFoundPath?: string
    publicRootHint?: boolean
    relativeRef?: string
    sourceSibling?: string
  }
) {
  const displayPath = opts?.overrideNotFoundPath || filePath
  const lines: string[] = []
  if (opts?.relativeRef) {
    lines.push(
      `Can't find the file ${colors.blue(opts.relativeRef)} listed in ${colors.blue(
        'web_accessible_resources'
      )}.`
    )
  } else {
    lines.push(
      `Can't find a file listed in ${colors.blue('web_accessible_resources')}.`
    )
  }

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(displayPath)}`)

  lines.push(
    `Only list assets your pages fetch with ${colors.blue('chrome.runtime.getURL()')}.`
  )
  lines.push(
    `Imports from content scripts are bundled automatically and don't need to be listed here.`
  )

  if (opts?.publicRootHint) {
    lines.push(
      `To reference files in ${colors.blue('public/')}, use a leading '/' (for example ${colors.blue('/open-panel.gif')}).`
    )
    lines.push(`These resolve from the built extension root.`)
    lines.push(
      `Learn more: ${colors.underline('https://extension.js.org/docs/development/web-accessible-resources')}`
    )
    lines.push(
      `Add the file to ${colors.blue('public/')}, or update the path to a root-absolute location.`
    )
  } else if (opts?.sourceSibling) {
    lines.push(
      `Found ${colors.underline(opts.sourceSibling)}, but web_accessible_resources entries are copied as-is, not compiled.`
    )
    lines.push(
      `Learn more: ${colors.underline('https://extension.js.org/docs/development/web-accessible-resources')}`
    )
    lines.push(`- Import the file from a script so it gets bundled.`)
    lines.push(
      `- Move a prebuilt copy to ${colors.blue('public/')} and reference it with a leading '/'.`
    )
  } else {
    lines.push(
      `Relative paths must point to a real source file so the build can emit it.`
    )
    lines.push(
      `Learn more: ${colors.underline('https://extension.js.org/docs/development/web-accessible-resources')}`
    )
    lines.push(
      `Create the missing file, or update the path to an existing source file.`
    )
  }

  return lines.join('\n')
}

export function warStringEntryInMv3(entry: string) {
  const lines: string[] = []
  lines.push(
    `Chrome rejects plain string entries in ${colors.blue('web_accessible_resources')} under Manifest V3.`
  )
  lines.push(`${colors.gray('GOT')} ${colors.underline(entry)}`)
  lines.push(`Plain string entries are the Manifest V2 format.`)
  lines.push(
    `Manifest V3 requires object entries with ${colors.blue('resources')} and ${colors.blue('matches')} (or ${colors.blue('extension_ids')}).`
  )
  lines.push(
    `Wrap it like ${colors.blue(`{"resources": ["${entry}"], "matches": ["<all_urls>"]}`)} with the matches your pages need.`
  )
  return lines.join('\n')
}

export function warInvalidMatchPattern(pattern: string) {
  const lines: string[] = []
  lines.push(
    `Chrome rejects a match pattern in ${colors.blue('web_accessible_resources')}.`
  )
  lines.push(`${colors.gray('GOT')} ${colors.underline(pattern)}`)
  lines.push(
    `Match patterns must end with ${colors.blue('/*')} and can't include deeper paths.`
  )
  lines.push(
    `Update the pattern in your ${colors.blue('manifest.json')} file. See ${colors.underline('https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources#manifest_declaration')} for the format.`
  )
  return lines.join('\n')
}

export function entryImportsSummary(
  entryCount: number,
  totalResources: number
) {
  return (
    `${prefix('debug')} war      entryImports entries=${String(entryCount)} ` +
    `resources=${String(totalResources)}`
  )
}

export function warPatchedSummary(
  v3Groups: number,
  v3ResourcesTotal: number,
  v2Resources: number
) {
  return (
    `${prefix('debug')} war      patched v3Groups=${String(v3Groups)} ` +
    `v3Resources=${String(v3ResourcesTotal)} v2Resources=${String(v2Resources)}`
  )
}

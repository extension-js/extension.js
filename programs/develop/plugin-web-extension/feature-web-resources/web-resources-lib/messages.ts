// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'

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
      `The file ${colors.yellow(opts.relativeRef)} defined in ${colors.yellow(
        'web_accessible_resources'
      )} was not found`
    )
  } else {
    lines.push(`${colors.yellow('web_accessible_resources')}: file not found`)
  }

  lines.push(
    `Only list assets your pages fetch with ${colors.yellow('chrome.runtime.getURL()')}. Imports from content scripts are bundled automatically and do not need to be listed here.`
  )

  if (opts?.publicRootHint) {
    lines.push(
      `To reference files in ${colors.yellow('public/')}, use a leading '/' (e.g. ${colors.yellow('/open-panel.gif')}). These resolve from the built extension root.`
    )
    lines.push('')
    lines.push(
      `Fix: Add the file to ${colors.yellow('public/')} or update the path to the correct '/...' location.`
    )
  } else if (opts?.sourceSibling) {
    lines.push(
      `Found ${colors.yellow(opts.sourceSibling)}, but web_accessible_resources entries are copied as-is, not compiled.`
    )
    lines.push('')
    lines.push(
      `Fix: Import the file from a script so it gets bundled, or move a prebuilt copy to ${colors.yellow('public/')} and reference it with a leading '/'.`
    )
  } else {
    lines.push(
      `Relative paths must point to a real source file so the build can emit it.`
    )
    lines.push('')
    lines.push(
      `Fix: Create the missing file or update the path to an existing source file.`
    )
  }

  lines.push(
    `Learn more: ${colors.underline('https://extension.js.org/docs/development/web-accessible-resources')}`
  )

  lines.push('')
  lines.push(`${colors.red('NOT FOUND')} ${colors.underline(displayPath)}`)
  return lines.join('\n')
}

export function warStringEntryInMv3(entry: string) {
  const lines: string[] = []
  lines.push(
    `Check the ${colors.yellow('web_accessible_resources')} field in your ${colors.yellow('manifest.json')} file.`
  )
  lines.push(
    `Manifest V3 requires object entries with ${colors.yellow('resources')} and ${colors.yellow('matches')} (or ${colors.yellow('extension_ids')}). Plain string entries are the Manifest V2 format and Chrome rejects them at load time.`
  )
  lines.push('')
  lines.push(
    `Fix: Wrap it like ${colors.yellow(`{"resources": ["${entry}"], "matches": ["<all_urls>"]}`)} with the matches your pages need.`
  )
  lines.push('')
  lines.push(`${colors.red('INVALID MV3 ENTRY')} ${colors.underline(entry)}`)
  return lines.join('\n')
}

export function warInvalidMatchPattern(pattern: string) {
  const lines: string[] = []
  lines.push(
    `Check the ${colors.yellow('web_accessible_resources')} field in your ${colors.yellow('manifest.json')} file.`
  )
  lines.push(
    `Chrome requires match patterns to end with ${colors.yellow('/*')} and not include deeper paths. See ${colors.underline('https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources#manifest_declaration')}`
  )
  lines.push('')
  lines.push(
    `${colors.red('INVALID MATCH PATTERN')} ${colors.underline(pattern)}`
  )
  return lines.join('\n')
}

export function entryImportsSummary(
  entryCount: number,
  totalResources: number
) {
  return `Web resources: content entry imports, entries=${String(entryCount)}, resources=${String(totalResources)}`
}

export function warPatchedSummary(
  v3Groups: number,
  v3ResourcesTotal: number,
  v2Resources: number
) {
  return `Web resources: WAR patched, v3Groups=${String(v3Groups)}, v3Resources=${String(v3ResourcesTotal)}, v2Resources=${String(v2Resources)}`
}

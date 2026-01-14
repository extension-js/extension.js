// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import colors from 'pintor'

function shortPath(p: string) {
  try {
    const cwd = process.cwd()
    const rel = path.relative(cwd, p)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel
    return p
  } catch {
    return p
  }
}

export function javaScriptError(
  errorSourcePath: string,
  missingFilePath: string,
  opts?: {publicRootHint?: boolean}
) {
  const lines: string[] = []
  lines.push(`Missing script file in ${colors.underline(errorSourcePath)}.`)
  lines.push(
    `Update your ${colors.yellow('<script>')} src to point to a file that exists.`
  )
  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.yellow('public/')}), not your source directory.`
    )
  }
  lines.push('')
  lines.push(`${colors.red('NOT FOUND')} ${colors.underline(missingFilePath)}`)
  return lines.join('\n')
}

export function cssError(
  errorSourcePath: string,
  missingFilePath: string,
  opts?: {publicRootHint?: boolean}
) {
  const lines: string[] = []
  lines.push(`Missing stylesheet in ${colors.underline(errorSourcePath)}.`)
  lines.push(
    `Update your ${colors.yellow('<link>')} href to point to a file that exists.`
  )
  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.yellow('public/')}), not your source directory.`
    )
  }
  lines.push('')
  lines.push(`${colors.red('NOT FOUND')} ${colors.underline(missingFilePath)}`)
  return lines.join('\n')
}

export function staticAssetError(
  errorSourcePath: string,
  missingFilePath: string,
  opts?: {publicRootHint?: boolean; refLabel?: string}
) {
  const extname = path.extname(missingFilePath)
  const lines: string[] = []
  lines.push(`Missing asset in ${colors.underline(errorSourcePath)}.`)
  const ref = opts?.refLabel || '*' + extname
  lines.push(
    `Update the ${colors.yellow(ref)} reference to point to a file that exists.`
  )
  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.yellow('public/')}), not your source directory.`
    )
  }
  lines.push('')
  lines.push(`${colors.red('NOT FOUND')} ${colors.underline(missingFilePath)}`)
  return lines.join('\n')
}

export function fileNotFound(
  errorSourcePath: string | undefined,
  missingFilePath: string,
  opts?: {publicRootHint?: boolean; refLabel?: string}
) {
  if (!errorSourcePath) {
    throw new Error('This operation is impossible. Please report a bug.')
  }
  switch (path.extname(missingFilePath)) {
    case '.js':
    case '.ts':
    case '.jsx':
    case '.tsx':
      return javaScriptError(errorSourcePath, missingFilePath, opts)
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return cssError(errorSourcePath, missingFilePath, opts)
    default:
      return staticAssetError(errorSourcePath, missingFilePath, opts)
  }
}

export function htmlFileNotFoundMessageOnly(
  context: 'script' | 'style' | 'static' = 'static'
) {
  const label =
    context === 'script'
      ? '<script>'
      : context === 'style'
        ? '<link>'
        : '*.<ext>'
  return `Check your ${label} references.`
}

export function remoteResourceWarning(
  errorSourcePath: string,
  remoteUrl: string,
  kind: 'script' | 'style'
) {
  const label = kind === 'script' ? '<script>' : '<link>'
  const cspHint =
    kind === 'script'
      ? 'Remote scripts are blocked by MV3 CSP; bundle or self-host instead.'
      : 'Remote styles may be blocked; prefer bundling or self-hosting.'
  const lines: string[] = []
  lines.push(
    `Remote ${colors.yellow(label)} in ${colors.underline(errorSourcePath)}. ${cspHint}`
  )
  lines.push('')
  lines.push(`${colors.red('URL')} ${colors.underline(remoteUrl)}`)
  return lines.join('\n')
}

export function serverRestartRequiredFromHtml(
  relativeHtmlPath: string,
  absoluteHtmlPath: string
) {
  const lines: string[] = []
  lines.push(
    `Entrypoint references changed. Restart the dev server to pick up changes to ${colors.yellow('<script>')} and ${colors.yellow('<link rel="stylesheet">')} entries.`
  )
  lines.push('')
  lines.push(`${colors.gray('PATH')} ${colors.underline(absoluteHtmlPath)}`)
  return lines.join('\n')
}

export function manifestHtmlEntrypointChange(
  manifestField?: string,
  pathAfter?: string,
  pathBefore?: string
) {
  const lines: string[] = []
  const fieldLabel = manifestField
    ? manifestField.replace(/\//g, '.')
    : undefined
  lines.push(
    `Entrypoint references changed${
      fieldLabel ? ` in ${colors.yellow(fieldLabel)}` : ''
    }. Restart the dev server to pick up changes to manifest entrypoints.`
  )
  lines.push('')
  if (pathBefore) {
    lines.push(`${colors.red('PATH BEFORE')} ${colors.underline(pathBefore)}`)
  }
  if (pathAfter) {
    lines.push(`${colors.green('PATH AFTER')} ${colors.underline(pathAfter)}`)
  }
  return lines.join('\n')
}

export function manifestFieldMessageOnly(manifestField: string) {
  const manifestFieldName = manifestField.startsWith('content_scripts')
    ? `content_scripts`
    : manifestField.replace('/', '.')
  const contentIndex = manifestField.split('-')[1]
  const isContentScripts = manifestField.startsWith('content_scripts')
  const fieldLabel = isContentScripts
    ? `content_scripts (index ${contentIndex})`
    : manifestFieldName
  return `Check the ${colors.yellow(fieldLabel)} field in your ${colors.yellow('manifest.json')} file.`
}

// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
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
  opts?: {publicRootHint?: boolean; deadRefHint?: boolean}
) {
  const lines: string[] = []
  lines.push(`The page references a script file that doesn't exist.`)
  lines.push(`${colors.gray('PATH')} ${colors.underline(errorSourcePath)}`)
  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(missingFilePath)}`)
  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.blue('public/')}), not your source directory.`
    )
  }
  if (opts?.deadRefHint) {
    // Honest consequence: scripts are bundler entries, so the build emits an EMPTY
    // placeholder - the page loads and DevTools shows no 404.
    lines.push(
      `The build ships an empty placeholder for this script, so the page loads and no 404 appears in DevTools (likely dead code).`
    )
  }
  lines.push(
    `Update the ${colors.blue('<script>')} src to point to a file that exists.`
  )
  if (opts?.deadRefHint) {
    lines.push(
      `Set ${colors.blue('EXTENSION_STRICT_REFS=true')} to make this a build error.`
    )
  }
  return lines.join('\n')
}

export function cssError(
  errorSourcePath: string,
  missingFilePath: string,
  opts?: {publicRootHint?: boolean; deadRefHint?: boolean}
) {
  const lines: string[] = []
  lines.push(`The page references a stylesheet that doesn't exist.`)
  lines.push(`${colors.gray('PATH')} ${colors.underline(errorSourcePath)}`)
  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(missingFilePath)}`)
  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.blue('public/')}), not your source directory.`
    )
  }
  if (opts?.deadRefHint) {
    lines.push(
      `Chrome loads the page anyway and 404s this reference silently, so it is likely dead code.`
    )
  }
  lines.push(
    `Update the ${colors.blue('<link>')} href to point to a file that exists.`
  )
  if (opts?.deadRefHint) {
    lines.push(
      `Set ${colors.blue('EXTENSION_STRICT_REFS=true')} to make this a build error.`
    )
  }
  return lines.join('\n')
}

export function staticAssetError(
  errorSourcePath: string,
  missingFilePath: string,
  opts?: {publicRootHint?: boolean; refLabel?: string; deadRefHint?: boolean}
) {
  const extname = path.extname(missingFilePath)
  const lines: string[] = []
  lines.push(`The page references an asset that doesn't exist.`)
  lines.push(`${colors.gray('PATH')} ${colors.underline(errorSourcePath)}`)
  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(missingFilePath)}`)
  const ref = opts?.refLabel || `*${extname}`
  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.blue('public/')}), not your source directory.`
    )
  }
  if (opts?.deadRefHint) {
    lines.push(
      `Chrome loads the page anyway and 404s this reference silently, so it is likely dead code.`
    )
  }
  lines.push(
    `Update the ${colors.blue(ref)} reference to point to a file that exists.`
  )
  if (opts?.deadRefHint) {
    lines.push(
      `Set ${colors.blue('EXTENSION_STRICT_REFS=true')} to make this a build error.`
    )
  }
  return lines.join('\n')
}

export function fileNotFound(
  errorSourcePath: string | undefined,
  missingFilePath: string,
  opts?: {publicRootHint?: boolean; refLabel?: string; deadRefHint?: boolean}
) {
  if (!errorSourcePath) {
    throw new Error('This state should not occur. Report a bug.')
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
  const lines: string[] = []
  lines.push(
    kind === 'script'
      ? `The page loads a remote ${colors.blue(label)}, which the MV3 CSP blocks.`
      : `The page loads a remote ${colors.blue(label)}, which the CSP can block.`
  )
  lines.push(`${colors.gray('PATH')} ${colors.underline(errorSourcePath)}`)
  lines.push(`${colors.gray('GOT')} ${colors.underline(remoteUrl)}`)
  lines.push(
    kind === 'script'
      ? `Bundle the script or self-host it instead.`
      : `Bundle the stylesheet or self-host it instead.`
  )
  return lines.join('\n')
}

export function serverRestartRequiredFromHtml(
  relativeHtmlPath: string,
  absoluteHtmlPath: string
) {
  const lines: string[] = []
  lines.push(`Entrypoint references changed.`)
  lines.push(`${colors.gray('PATH')} ${colors.underline(absoluteHtmlPath)}`)
  lines.push(
    `Restart the dev server to pick up changes to ${colors.blue('<script>')} and ${colors.blue('<link rel="stylesheet">')} entries.`
  )
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
      fieldLabel ? ` in ${colors.blue(fieldLabel)}` : ''
    }.`
  )
  if (pathBefore) {
    lines.push(`${colors.gray('EXPECTED')} ${colors.underline(pathBefore)}`)
  }
  if (pathAfter) {
    lines.push(`${colors.gray('GOT')} ${colors.underline(pathAfter)}`)
  }
  lines.push(
    `Restart the dev server to pick up changes to manifest entrypoints.`
  )
  return lines.join('\n')
}

export function manifestPageMissing(
  manifestField: string,
  missingFilePath: string
) {
  const lines: string[] = []
  lines.push(`Can't find the page listed in ${colors.blue(manifestField)}.`)
  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(missingFilePath)}`)
  lines.push(
    `Update the path in your ${colors.blue('manifest.json')} to an HTML file that exists.`
  )
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
  return `Check the ${colors.blue(fieldLabel)} field in your ${colors.blue('manifest.json')} file.`
}

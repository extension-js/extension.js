// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import colors from 'pintor'
import {type WithheldKind, withheldFileLines} from '../../../lib/withheld-file'

export function javaScriptError(
  errorSourcePath: string,
  missingFilePath: string,
  opts?: {publicRootHint?: boolean; deadRefHint?: boolean; copiedPage?: boolean}
) {
  const lines: string[] = []
  lines.push(`The page references a script file that doesn't exist.`)
  lines.push(`${colors.gray('PATH')} ${colors.underline(errorSourcePath)}`)
  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(missingFilePath)}`)

  if (opts?.publicRootHint) {
    lines.push(
      `A path starting with '/' resolves from the extension root, so the file must sit at that path in your project or in ${colors.blue('public/')}.`
    )
  }

  if (opts?.deadRefHint) {
    // Honest consequence: scripts are bundler entries, so the build emits an EMPTY
    // placeholder - the page loads and DevTools shows no 404. A copied page
    // has no entry, so its browser asks for the file and gets a 404.
    lines.push(
      opts.copiedPage
        ? `Chrome loads the page anyway and 404s this reference silently, so it is likely dead code.`
        : `The build ships an empty placeholder for this script, so the page loads and no 404 appears in DevTools (likely dead code).`
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
      `A path starting with '/' resolves from the extension root, so the file must sit at that path in your project or in ${colors.blue('public/')}.`
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
      `A path starting with '/' resolves from the extension root, so the file must sit at that path in your project or in ${colors.blue('public/')}.`
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

export function fileIsFolder(
  errorSourcePath: string,
  folderPath: string,
  opts?: {refLabel?: string}
) {
  const lines: string[] = []
  lines.push(`The page references a folder where a file is expected.`)
  lines.push(`${colors.gray('PATH')} ${colors.underline(errorSourcePath)}`)
  lines.push(`${colors.gray('FOLDER')} ${colors.underline(folderPath)}`)
  lines.push(
    `Chrome loads the page anyway and 404s this reference, so nothing was copied for it.`
  )

  lines.push(
    `Update the ${colors.blue(opts?.refLabel || path.basename(folderPath))} reference to point to a file, for example one inside that folder.`
  )

  return lines.join('\n')
}

export function fileNotFound(
  errorSourcePath: string | undefined,
  missingFilePath: string,
  opts?: {
    publicRootHint?: boolean
    refLabel?: string
    deadRefHint?: boolean
    // A page shipped as a copy, whose scripts are no bundler entries.
    copiedPage?: boolean
    // The tag that named the file, which says more than an ending does.
    kind?: 'script' | 'style'
  }
) {
  if (!errorSourcePath) {
    throw new Error('This state should not occur. Report a bug.')
  }

  if (opts?.kind === 'script') {
    return javaScriptError(errorSourcePath, missingFilePath, opts)
  }

  if (opts?.kind === 'style') {
    return cssError(errorSourcePath, missingFilePath, opts)
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

// A file the page names that is there and stays out of the build, worded
// so the author does not go looking for a file that is right there.
export function pageRefWithheld(
  errorSourcePath: string,
  withheldPath: string,
  ref: string,
  why: WithheldKind,
  opts?: {kind?: 'script' | 'style'; deadRefHint?: boolean}
) {
  // Without the tag at hand, the ending says which tag named it.
  const kind =
    opts?.kind ||
    (/\.(?:[jt]sx?)$/.test(withheldPath)
      ? 'script'
      : /\.(?:css|scss|sass|less)$/.test(withheldPath)
        ? 'style'
        : undefined)
  const tag =
    kind === 'script'
      ? colors.blue('<script>')
      : kind === 'style'
        ? colors.blue('<link>')
        : `tag`
  const lines: string[] = withheldFileLines(ref, why, {
    check: `Check the ${tag} that names it in this page.`,
    holds: kind === 'script' ? 'code' : 'contents'
  })

  lines.push(`${colors.gray('PATH')} ${colors.underline(errorSourcePath)}`)
  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(withheldPath)}`)
  lines.push(`The page loads without it.`)

  if (opts?.deadRefHint) {
    lines.push(
      `Set ${colors.blue('EXTENSION_STRICT_REFS=true')} to make this a build error.`
    )
  }

  return lines.join('\n')
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

export function serverRestartRequiredFromHtml(absoluteHtmlPath: string) {
  const lines: string[] = []
  lines.push(`Entrypoint references changed.`)
  lines.push(`${colors.gray('PATH')} ${colors.underline(absoluteHtmlPath)}`)
  lines.push(
    `Restart the dev server to pick up changes to ${colors.blue('<script>')} and ${colors.blue('<link rel="stylesheet">')} entries.`
  )

  return lines.join('\n')
}

// A script or stylesheet that was missing at startup is not in the page
// entry, and an entry cannot grow while the compiler runs.
export function serverRestartRequiredFromCreatedFile(
  absoluteHtmlPath: string,
  createdFilePath: string
) {
  const lines: string[] = []
  lines.push(`A file the page references was created.`)
  lines.push(`${colors.gray('PATH')} ${colors.underline(absoluteHtmlPath)}`)
  lines.push(`${colors.gray('FILE')} ${colors.underline(createdFilePath)}`)
  lines.push(`Restart the dev server to add it to the page.`)

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

// A page decoded from the charset it declares. The build goes on, and the
// warning stops once the file itself is UTF-8.
export function pageConvertedToUtf8(file: string, charset: string) {
  const lines: string[] = []
  lines.push(
    `${colors.underline(file)} is encoded as ${colors.blue(charset)}, so the build converted it to UTF-8.`
  )

  lines.push(
    `The built page declares ${colors.blue('utf-8')} and shows the same text.`
  )

  lines.push(`Save the file as UTF-8 to build it as written.`)

  return lines.join('\n')
}

// A page no charset could decode, which a browser shows with a
// replacement character in place of each byte that is not UTF-8.
export function pageNotUtf8(file: string, charset: string | undefined) {
  const lines: string[] = []
  lines.push(
    charset
      ? `${colors.underline(file)} is not UTF-8, and its declared charset ${colors.blue(charset)} cannot decode it.`
      : `${colors.underline(file)} is not UTF-8 and declares no charset.`
  )

  lines.push(
    `The built page shows a replacement character for each byte that is not UTF-8.`
  )

  lines.push(
    `Save the file as UTF-8 and declare ${colors.blue('<meta charset="utf-8">')}.`
  )

  return lines.join('\n')
}

// A page file that is there and stays out of the build. The field names
// the manifest key, or the page when no key names it.
export function pageFileWithheld(
  where: {manifestField?: string; pageName: string},
  file: string,
  why: WithheldKind,
  withheldPath: string
) {
  const lines: string[] = withheldFileLines(file, why, {
    check: where.manifestField
      ? `Check the ${colors.blue(where.manifestField)} field in your ${colors.blue('manifest.json')} file.`
      : `It is the file of the page ${colors.blue(where.pageName)}.`,
    holds: 'page'
  })

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(withheldPath)}`)

  return lines.join('\n')
}

// A page the pages folder or a script names has no manifest field to
// point at, so the message names the file the build looked for.
export function pageFileMissing(pageName: string, missingFilePath: string) {
  const lines: string[] = []
  lines.push(`Can't find the file of the page ${colors.blue(pageName)}.`)
  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(missingFilePath)}`)
  lines.push(
    `Add the file back, or restart the dev server if you removed the page.`
  )

  return lines.join('\n')
}

// A copied page's script ships as written, so an import it cannot follow
// breaks it at runtime. The paths are relative to the project. No word here
// may read as a browser or manifest issue to the warning categories.
export function unbundledScriptImport(
  pageFile: string,
  scriptFile: string,
  specifier: string,
  // The extension path the page asks for, unset for a package name.
  requestedPath: string | undefined,
  opts?: {deadRefHint?: boolean}
) {
  const lines: string[] = []
  lines.push(
    requestedPath === undefined
      ? `A script of this page imports a package by name, which the page cannot resolve at runtime.`
      : `A script of this page imports a file that does not ship.`
  )

  lines.push(`${colors.gray('PATH')} ${colors.underline(pageFile)}`)
  lines.push(`${colors.gray('SCRIPT')} ${colors.underline(scriptFile)}`)
  lines.push(`${colors.gray('IMPORT')} ${colors.yellow(specifier)}`)

  if (requestedPath !== undefined) {
    lines.push(
      `At runtime the page asks for ${colors.underline(`/${requestedPath}`)} and gets a 404.`
    )
  }

  lines.push(
    `Only another page reaches this page, so its scripts are copied as written and not bundled.`
  )

  lines.push(
    requestedPath === undefined
      ? `Put the page under ${colors.blue('pages/')} so it is bundled, or ship the package's file too and import it by its path.`
      : `Put the page under ${colors.blue('pages/')} so it is bundled, or ship the imported file too at that path, for example from ${colors.blue('public/')}.`
  )

  if (opts?.deadRefHint) {
    lines.push(
      `Set ${colors.blue('EXTENSION_STRICT_REFS=true')} to make this a build error.`
    )
  }

  return lines.join('\n')
}

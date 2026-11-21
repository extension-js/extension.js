//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'

interface SourceMapModuleInfo {
  absoluteResourcePath: string
  resourcePath: string
  namespace: string
}

// The author's files keep the bundler's default name. Extension.js's own
// files sit outside the project, where that name climbs to the install, so
// they read as extension.js/ in the browser's source tree instead.
function inside(root: string, file: string): string | undefined {
  const relative = path.relative(root, file)

  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : undefined
}

const holds = (folder: string, other: string) =>
  folder === other || inside(folder, other) !== undefined

const INSTALLED = `${path.sep}node_modules${path.sep}`

// A package Extension.js installed for itself: one its own lookup reaches
// and the project's never does. A package both reach is the project's.
function ownDependency(
  developRoot: string,
  projectRoot: string,
  file: string
): string | undefined {
  const first = file.indexOf(INSTALLED)

  if (first === -1) return undefined

  const installedUnder = file.slice(0, first)

  return holds(installedUnder, developRoot) &&
    !holds(installedUnder, projectRoot)
    ? file.slice(file.lastIndexOf(INSTALLED) + 1)
    : undefined
}

export function sourceMapModuleName(
  developRoot: string | undefined,
  projectRoot: string
) {
  return (info: SourceMapModuleInfo): string => {
    const resource = String(info.absoluteResourcePath || '')
    const base = `webpack://${info.namespace}/`
    const own =
      developRoot && path.isAbsolute(resource) && !inside(projectRoot, resource)
        ? (inside(developRoot, resource) ??
          ownDependency(developRoot, projectRoot, resource))
        : undefined

    return own
      ? `${base}extension.js/${own.split(path.sep).join('/')}`
      : `${base}${info.resourcePath}`
  }
}

//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'

export interface SourceMapModuleInfo {
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

export function sourceMapModuleName(
  developRoot: string | undefined,
  projectRoot: string
) {
  return (info: SourceMapModuleInfo): string => {
    const resource = String(info.absoluteResourcePath || '')
    const base = `webpack://${info.namespace}/`
    const own =
      developRoot && path.isAbsolute(resource) && !inside(projectRoot, resource)
        ? inside(developRoot, resource)
        : undefined

    return own
      ? `${base}extension.js/${own.split(path.sep).join('/')}`
      : `${base}${info.resourcePath}`
  }
}

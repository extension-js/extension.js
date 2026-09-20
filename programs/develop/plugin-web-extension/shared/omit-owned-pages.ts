//  ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
//  ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
//  ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
//  ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
//  ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
//  ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {FilepathList} from '../../types'

function filesOf(value: FilepathList[string]): string[] {
  if (Array.isArray(value)) return value

  return value ? [value] : []
}

// A page the manifest names is an entry once, under the manifest's name. The
// pages/ scan reaches the same file by its folder path, and entering it again
// ships the page twice and prints every warning for it twice.
export function omitOwnedPages(
  pages: FilepathList | undefined,
  owned: FilepathList
): FilepathList {
  const ownedFiles = new Set(
    Object.values(owned)
      .flatMap(filesOf)
      .map((file) => path.resolve(file))
  )

  const next: FilepathList = {}

  for (const [name, value] of Object.entries(pages || {})) {
    const files = filesOf(value)

    if (
      files.length > 0 &&
      files.every((file) => ownedFiles.has(path.resolve(file)))
    ) {
      continue
    }

    next[name] = value
  }

  return next
}

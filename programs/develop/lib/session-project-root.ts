// ███████╗███████╗███████╗███████╗██╗ ██████╗ ███╗   ██╗      ██████╗  █████╗ ████████╗██╗  ██╗███████╗
// ██╔════╝██╔════╝██╔════╝██╔════╝██║██╔═══██╗████╗  ██║      ██╔══██╗██╔══██╗╚══██╔══╝██║  ██║██╔════╝
// ███████╗█████╗  ███████╗███████╗██║██║   ██║██╔██╗ ██║█████╗██████╔╝███████║   ██║   ███████║███████╗
// ╚════██║██╔══╝  ╚════██║╚════██║██║██║   ██║██║╚██╗██║╚════╝██╔═══╝ ██╔══██║   ██║   ██╔══██║╚════██║
// ███████║███████╗███████║███████║██║╚██████╔╝██║ ╚████║      ██║     ██║  ██║   ██║   ██║  ██║███████║
// ╚══════╝╚══════╝╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {getDirs} from './paths'
import {resolveProjectStructureSync} from './project'

function isLocalDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

// `dev` anchors ready.json, logs.ndjson and the control channel at the
// package root it walks up to from the manifest, so every reader of those
// files has to resolve a project path the same way or miss a live session.
export function resolveSessionProjectRoot(pathArg?: string): string {
  const inputPath = path.resolve(pathArg || process.cwd())
  if (!isLocalDirectory(inputPath)) return inputPath
  try {
    const structure = resolveProjectStructureSync(inputPath, {quiet: true})
    return getDirs(structure).packageJsonDir
  } catch {
    return inputPath
  }
}

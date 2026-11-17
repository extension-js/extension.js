//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as messages from './messages'

// The folder a typed local path names, when it is not there. The engine read
// that as a missing manifest, a different mistake with a different fix.
export function missingProjectFolder(
  pathOrRemoteUrl: string | undefined,
  cwd = process.cwd()
): string | undefined {
  if (!pathOrRemoteUrl) return undefined
  // A scheme of two letters or more is a URL. One letter is a Windows drive.
  if (/^[a-z][a-z0-9+.-]+:/i.test(pathOrRemoteUrl)) return undefined

  const folder = path.resolve(cwd, pathOrRemoteUrl)

  return fs.existsSync(folder) ? undefined : folder
}

export interface MissingProjectRefusal {
  message: string
  hint: string
  // The message and the hint as the terminal prints them.
  stderr: string
}

export function missingProjectRefusal(
  command: string,
  folder: string
): MissingProjectRefusal {
  const message = messages.projectFolderMissing(folder)
  const hint = messages.projectFolderMissingHint(command)

  return {message, hint, stderr: messages.usageRefusal(`${message}\n${hint}`)}
}

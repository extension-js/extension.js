// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {codedError} from './coded-error'
import * as messages from './messages'
import {CODES} from './messaging'
import type {ParsedJson} from './parse-json-safe'

// A remote URL joined with a file name reads as "https:/host/..." (or with
// backslashes on Windows), a relative path whose ancestry never holds a
// manifest. Windows drive letters are a single character, so they do not match.
function isUrlShaped(target: string): boolean {
  // path.join on Windows also prefixes the URL with a dot segment.
  return /^(?:\.[\\/])?[a-z][a-z0-9+.-]+:[\\/]+/i.test(target)
}

function findUpLocalSync(
  filename: string,
  options: {cwd: string}
): string | undefined {
  if (isUrlShaped(options.cwd)) return undefined

  const root = path.parse(path.resolve(options.cwd)).root
  let currentDir = path.resolve(options.cwd)

  while (true) {
    const candidate = path.join(currentDir, filename)

    try {
      const stat = fs.statSync(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // Ignore
    }

    // A relative start (a URL handed in as a path) never reaches the
    // filesystem root, so stop as soon as the walk stops climbing.
    const parentDir = path.dirname(currentDir)
    if (currentDir === root || parentDir === currentDir) return undefined

    currentDir = parentDir
  }
}

export function findNearestPackageJsonSync(
  manifestPath: string
): string | null {
  try {
    const manifestDir = path.dirname(manifestPath)
    const packageJsonPath = findUpLocalSync('package.json', {
      cwd: manifestDir
    })

    return packageJsonPath || null
  } catch {
    // Only a path that is not a string throws here, and the answer for it
    // is the same as for a folder with no package.json above it.
    return null
  }
}

// The bundler's resolver and Node.js read the bytes as plain UTF-8 JSON, so a
// byte order mark or UTF-16 fails there, later and with no file named well.
function unreadableEncodingOf(bytes: Buffer): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'UTF-8 with a byte order mark'
  }

  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'UTF-16 LE'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'UTF-16 BE'
  if (bytes.length > 1 && bytes[0] !== 0 && bytes[1] === 0) return 'UTF-16 LE'
  if (bytes.length > 1 && bytes[0] === 0 && bytes[1] !== 0) return 'UTF-16 BE'

  return undefined
}

// The one read of a project's package.json: every reader takes the same
// object, and a file no tool can parse is refused once, by its own code.
export function readPackageJson(packageJsonPath: string): ParsedJson {
  const bytes = fs.readFileSync(packageJsonPath)
  const encoding = unreadableEncodingOf(bytes)

  if (encoding) {
    throw codedError(
      CODES.E_PACKAGE_JSON_INVALID,
      messages.packageJsonNotUtf8(packageJsonPath, encoding)
    )
  }

  try {
    return JSON.parse(bytes.toString('utf8') || '{}')
  } catch (error) {
    throw codedError(
      CODES.E_PACKAGE_JSON_INVALID,
      messages.packageJsonInvalid(
        packageJsonPath,
        error instanceof Error ? error.message : String(error)
      )
    )
  }
}

// False when no file is there. A file that is there and cannot be parsed
// throws, since a project whose package.json is ignored builds the wrong thing.
export function validatePackageJson(packageJsonPath: string): boolean {
  if (!fs.existsSync(packageJsonPath)) return false

  readPackageJson(packageJsonPath)

  return true
}

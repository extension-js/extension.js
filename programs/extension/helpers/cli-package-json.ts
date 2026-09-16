//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'

type CliPackageJson = {version?: string; name?: string} & Record<
  string,
  unknown
>

let cachedPackageJson: CliPackageJson | null = null

export function getCliPackageJson(): CliPackageJson {
  if (cachedPackageJson) return cachedPackageJson

  const candidates = [
    path.resolve(__dirname, 'package.json'),
    path.resolve(__dirname, '..', 'package.json')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, 'utf8')
      const parsed = JSON.parse(content) as CliPackageJson
      cachedPackageJson = parsed

      return parsed
    }
  }

  throw new Error('Extension.js CLI package.json not found.')
}

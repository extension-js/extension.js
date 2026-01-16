//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'

let cachedPackageJson: Record<string, any> | null = null

export function getCliPackageJson(): Record<string, any> {
  if (cachedPackageJson) return cachedPackageJson

  const candidates = [
    path.resolve(__dirname, 'package.json'),
    path.resolve(__dirname, '..', 'package.json')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, 'utf8')
      cachedPackageJson = JSON.parse(content)
      return cachedPackageJson
    }
  }

  throw new Error('Extension.js CLI package.json not found.')
}

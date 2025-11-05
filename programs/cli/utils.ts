import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import fs from 'node:fs'

export type Browser = 'chrome' | 'edge' | 'firefox'

export function parseOptionalBoolean(value?: string): boolean {
  if (typeof value === 'undefined') return true
  const normalized = String(value).trim().toLowerCase()
  return !['false', '0', 'no', 'off'].includes(normalized)
}

export async function requireOrDlx(
  moduleName: string,
  versionHint?: string
): Promise<any> {
  try {
    return await import(moduleName)
  } catch {}

  const spec = versionHint ? `${moduleName}@${versionHint}` : moduleName
  const cacheDir = path.join(os.tmpdir(), 'extensionjs-cache', spec)
  const modulePath = path.join(cacheDir, 'node_modules', moduleName)

  const prefer = String(process.env.EXTJS_DLX || '')
    .trim()
    .toLowerCase()
  const isWin = process.platform === 'win32'
  const npmCmd = isWin ? 'npm.cmd' : 'npm'
  const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm'
  const bunCmd = isWin ? 'bun.exe' : 'bun'

  try {
    fs.mkdirSync(cacheDir, {recursive: true})
  } catch {}

  try {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(modulePath, 'package.json'), 'utf8')
    )
    const main = (pkgJson.main ||
      pkgJson.exports?.['.']?.import ||
      pkgJson.exports?.['.']?.require) as string | undefined
    if (main) {
      const resolved = pathToFileURL(path.join(modulePath, main)).href
      return await import(resolved)
    }
  } catch {}

  if (prefer === 'pnpm') {
    try {
      fs.writeFileSync(
        path.join(cacheDir, 'package.json'),
        JSON.stringify({name: 'extensionjs-cache', private: true}, null, 2)
      )
    } catch {}
  }

  let status = 0
  if (prefer === 'pnpm') {
    const args = ['add', spec, '--reporter', 'silent', '--no-frozen-lockfile']
    status =
      spawnSync(pnpmCmd, args, {cwd: cacheDir, stdio: 'ignore'}).status || 0
  } else if (prefer === 'bun') {
    const args = ['add', spec]
    status =
      spawnSync(bunCmd, args, {cwd: cacheDir, stdio: 'ignore'}).status || 0
  } else {
    const args = [
      'i',
      spec,
      '--no-fund',
      '--no-audit',
      '--prefer-online',
      '--omit=dev',
      '--no-package-lock'
    ]
    status =
      spawnSync(npmCmd, args, {cwd: cacheDir, stdio: 'ignore'}).status || 0
  }

  if (status !== 0) {
    throw new Error(`Failed to install ${spec}`)
  }

  try {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(modulePath, 'package.json'), 'utf8')
    )
    const main = (pkgJson.main ||
      pkgJson.exports?.['.']?.import ||
      pkgJson.exports?.['.']?.require) as string | undefined
    if (main) {
      const resolved = pathToFileURL(path.join(modulePath, main)).href
      return await import(resolved)
    }
  } catch {}

  return await import(
    pathToFileURL(path.join(modulePath, 'dist', 'module.js')).href
  )
}

export const vendors = (browser?: Browser | 'all') => {
  const value = (browser ?? 'chrome') as string
  return value === 'all'
    ? ['chrome', 'edge', 'firefox']
    : String(value).split(',')
}

export function validateVendorsOrExit(
  vendorsList: string[],
  onInvalid: (invalid: string, supported: string[]) => void
) {
  const supported = ['chrome', 'edge', 'firefox']
  for (const v of vendorsList) {
    if (!supported.includes(v)) {
      onInvalid(v, supported)
      process.exit(1)
    }
  }
}

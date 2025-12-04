import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import fs from 'node:fs'

function copyIfExists(src: string, dest: string): void {
  try {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest)
    }
  } catch {
    // best-effort only – missing or unreadable config should not break CLI
  }
}

function syncPackageManagerConfig(cacheDir: string): void {
  const cwd = process.cwd()

  // Mirror per-project config so dlx installs (run in a temp dir) still
  // respect the user's registry/auth settings.
  copyIfExists(path.join(cwd, '.npmrc'), path.join(cacheDir, '.npmrc'))
  copyIfExists(
    path.join(cwd, '.pnpmfile.cjs'),
    path.join(cacheDir, '.pnpmfile.cjs')
  )
}

export function resolveModuleEntry(
  modulePath: string,
  pkgJson: any
): string | undefined {
  const exportsField = pkgJson.exports
  let main: string | undefined = pkgJson.main

  // Handle "exports" as a string (Like{ "exports": "./dist/module.js" })
  if (!main && typeof exportsField === 'string') {
    main = exportsField
  }

  // Handle "exports" as an object
  if (!main && exportsField && typeof exportsField === 'object') {
    const dotExport = (exportsField as any)['.']

    if (typeof dotExport === 'string') {
      // Like{ "exports": { ".": "./dist/module.js" } }
      main = dotExport
    } else if (dotExport && typeof dotExport === 'object') {
      // Like{ "exports": { ".": { "import": "./dist/module.js", "require": "./dist/module.cjs" } } }
      main =
        (dotExport as any).import ||
        (dotExport as any).require ||
        (dotExport as any).default ||
        (dotExport as any).node
    }

    // Some packages put fields at the top level of "exports"
    if (!main) {
      const maybe =
        (exportsField as any).import ||
        (exportsField as any).require ||
        (exportsField as any).default ||
        (exportsField as any).node

      if (typeof maybe === 'string') {
        main = maybe
      }
    }
  }

  if (main) {
    return pathToFileURL(path.join(modulePath, main)).href
  }

  // Legacy/common filename fallbacks, in order of preference
  const candidates = [
    path.join(modulePath, 'dist', 'module.js'),
    path.join(modulePath, 'dist', 'index.js'),
    path.join(modulePath, 'index.js')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return pathToFileURL(candidate).href
    }
  }

  return undefined
}

export type Browser =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'

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
  const pkgJsonPath = path.join(modulePath, 'package.json')

  // Monorepo development fallback: use local sibling package if present
  try {
    const localDist = path.resolve(
      __dirname,
      '..', // dist/
      '..', // cli/ -> programs/
      'develop',
      'dist',
      'module.js'
    )
    if (fs.existsSync(localDist)) {
      return await import(pathToFileURL(localDist).href)
    }
  } catch {
    // Do nothing
  }

  try {
    const cwdDist = path.resolve(
      process.cwd(),
      'programs',
      'develop',
      'dist',
      'module.js'
    )
    if (fs.existsSync(cwdDist)) {
      return await import(pathToFileURL(cwdDist).href)
    }
  } catch {
    // Do nothing
  }

  let prefer = String(process.env.EXTENSION_DLX || '')
    .trim()
    .toLowerCase()
  const isWin = process.platform === 'win32'
  const npmCmd = isWin ? 'npm.cmd' : 'npm'
  const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm'
  const bunCmd = isWin ? 'bun.exe' : 'bun'

  // If no preference explicitly set, auto-prefer pnpm when available for faster installs
  if (!prefer) {
    try {
      const pnpmCheck = spawnSync(pnpmCmd, ['--version'], {stdio: 'ignore'})
      if ((pnpmCheck.status || 0) === 0) {
        prefer = 'pnpm'
      }
    } catch {}
  }

  try {
    fs.mkdirSync(cacheDir, {recursive: true})
  } catch {}

  // Ensure cache dir sees the same npm/pnpm config as the project so that
  // corporate/custom registries work for dlx installs.
  syncPackageManagerConfig(cacheDir)

  let preInstallPkgJson: any
  try {
    preInstallPkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  } catch {
    // Do nothing – package may not be installed yet
  }

  if (preInstallPkgJson) {
    const entry = resolveModuleEntry(modulePath, preInstallPkgJson)
    if (entry) {
      // Surface import-time errors so they are not mislabeled as resolution issues
      return await import(entry)
    }
  }

  if (prefer === 'pnpm') {
    try {
      fs.writeFileSync(
        path.join(cacheDir, 'package.json'),
        JSON.stringify({name: 'extensionjs-cache', private: true}, null, 2)
      )
    } catch {
      // Do nothing
    }
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
      '--omit=optional',
      '--no-package-lock'
    ]
    status =
      spawnSync(npmCmd, args, {cwd: cacheDir, stdio: 'ignore'}).status || 0
  }

  // Fallback to alternate package managers if the preferred one failed
  if (status !== 0) {
    // Try pnpm fallback
    try {
      fs.writeFileSync(
        path.join(cacheDir, 'package.json'),
        JSON.stringify({name: 'extensionjs-cache', private: true}, null, 2)
      )
    } catch {
      // Do nothing
    }

    if (prefer !== 'pnpm') {
      const args = ['add', spec, '--reporter', 'silent', '--no-frozen-lockfile']
      status =
        spawnSync(pnpmCmd, args, {cwd: cacheDir, stdio: 'ignore'}).status || 0
    }
  }
  if (status !== 0 && prefer !== 'bun') {
    const args = ['add', spec]
    status =
      spawnSync(bunCmd, args, {cwd: cacheDir, stdio: 'ignore'}).status || 0
  }

  if (status !== 0) {
    throw new Error(`Failed to install ${spec}`)
  }

  let postInstallPkgJson: any

  // If install reported success but the package.json is still missing,
  // attempt a last-resort npm install into the same cache directory before
  // surfacing a clear installation error.
  if (!fs.existsSync(pkgJsonPath)) {
    try {
      const args = [
        'i',
        spec,
        '--no-fund',
        '--no-audit',
        '--prefer-online',
        '--omit=dev',
        '--omit=optional',
        '--no-package-lock'
      ]
      const npmStatus =
        spawnSync(isWin ? 'npm.cmd' : 'npm', args, {
          cwd: cacheDir,
          stdio: 'ignore'
        }).status || 0

      if (npmStatus !== 0 || !fs.existsSync(pkgJsonPath)) {
        throw new Error(
          `Failed to install ${spec}: package.json not found at ${pkgJsonPath}. ` +
            'If you use a custom registry or auth, ensure your npm/pnpm config is visible to the Extension.js CLI.'
        )
      }
    } catch (err) {
      if (err instanceof Error) throw err
      throw new Error(
        `Failed to install ${spec}: package.json not found at ${pkgJsonPath}. ` +
          'If you use a custom registry or auth, ensure your npm/pnpm config is visible to the Extension.js CLI.'
      )
    }
  }

  try {
    postInstallPkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  } catch {
    // Do nothing – if package.json is unreadable, fall through to generic error
  }

  if (postInstallPkgJson) {
    const entry = resolveModuleEntry(modulePath, postInstallPkgJson)
    if (entry) {
      // Surface import-time errors so we see the real root cause (especially on Windows)
      return await import(entry)
    }
  }

  throw new Error(
    `Failed to resolve entry point for ${moduleName} (${spec}) at ${modulePath}.` +
      ' This likely means the installed "extension-develop" version is incompatible with this CLI.'
  )
}

export const vendors = (browser?: Browser | 'all') => {
  const value = (browser ?? 'chromium') as string
  return value === 'all'
    ? ['chrome', 'edge', 'firefox']
    : String(value).split(',')
}

export function validateVendorsOrExit(
  vendorsList: string[],
  onInvalid: (invalid: string, supported: string[]) => void
) {
  const supported = [
    'chrome',
    'edge',
    'firefox',
    'chromium',
    'chromium-based',
    'gecko-based',
    'firefox-based'
  ]
  for (const v of vendorsList) {
    if (!supported.includes(v)) {
      onInvalid(v, supported)
      process.exit(1)
    }
  }
}

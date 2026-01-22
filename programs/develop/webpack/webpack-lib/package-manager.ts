import * as fs from 'fs'
import * as path from 'path'

type PackageManagerName = 'pnpm' | 'yarn' | 'npm'

function detectPackageManagerFromEnv(): PackageManagerName {
  const userAgent = process.env.npm_config_user_agent || ''

  if (userAgent.includes('pnpm')) return 'pnpm'
  if (userAgent.includes('yarn')) return 'yarn'
  if (userAgent.includes('npm')) return 'npm'

  const execPath = process.env.npm_execpath || process.env.NPM_EXEC_PATH || ''

  if (execPath.includes('pnpm')) return 'pnpm'
  if (execPath.includes('yarn')) return 'yarn'
  if (execPath.includes('npm')) return 'npm'

  return 'npm'
}

export function getInstallCommandForPath(cwd: string): PackageManagerName {
  const hasPnpmLock = fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))
  const hasYarnLock = fs.existsSync(path.join(cwd, 'yarn.lock'))
  const hasNpmLock = fs.existsSync(path.join(cwd, 'package-lock.json'))

  if (hasPnpmLock) return 'pnpm'
  if (hasYarnLock) return 'yarn'
  if (hasNpmLock) return 'npm'

  return detectPackageManagerFromEnv()
}

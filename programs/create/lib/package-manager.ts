type PackageManagerName = 'pnpm' | 'yarn' | 'npm'

export function detectPackageManagerFromEnv(): PackageManagerName {
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

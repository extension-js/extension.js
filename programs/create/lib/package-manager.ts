type PackageManagerName = 'pnpm' | 'yarn' | 'npm'

const userAgentPattern = /(pnpm|yarn|npm)\/([0-9]+\.[0-9]+\.[0-9]+[^ ]*)/i

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

export function getPackageManagerSpecFromEnv(): string | null {
  const userAgent = process.env.npm_config_user_agent || ''
  const match = userAgent.match(userAgentPattern)

  if (!match) return null

  const name = match[1]
  const version = match[2]

  if (!name || !version) return null

  return `${name}@${version}`
}

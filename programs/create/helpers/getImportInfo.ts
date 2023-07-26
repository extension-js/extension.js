//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

export function getExternalImportInfo(template: string) {
  const isGitHubTemplate = new URL(template).hostname.includes('github.com')

  if (isGitHubTemplate) {
    const [, owner, project] = new URL(template).pathname.split('/')
    return `github:${owner}/${project}`
  }

  // On npm, the first index refers to "package"
  const [, , pkgOrScope, likelyPackage] = new URL(template).pathname.split('/')
  const scopedPackage = pkgOrScope.startsWith('@')

  return scopedPackage ? `${pkgOrScope}/${likelyPackage}` : `${pkgOrScope}`
}

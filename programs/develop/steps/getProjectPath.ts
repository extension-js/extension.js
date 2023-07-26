// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import goGitIt from 'go-git-it'

function importUrlSource(workingDir: string, pathOrRemoteUrl: string) {
  if (new URL(pathOrRemoteUrl).hostname !== 'github.com') {
    console.log(`
      The remote extension URL must be stored on GitHub.
    `)
    process.exit(1)
  }

  goGitIt(pathOrRemoteUrl)

  return path.resolve(workingDir, path.basename(pathOrRemoteUrl))
}

export default function getProjectPath(pathOrRemoteUrl: string | undefined) {
  if (!pathOrRemoteUrl) {
    return process.cwd()
  }

  if (pathOrRemoteUrl.startsWith('http')) {
    return importUrlSource(process.cwd(), pathOrRemoteUrl)
  }

  return path.resolve(process.cwd(), pathOrRemoteUrl)
}

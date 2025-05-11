import path from 'path'
import * as goGitItLib from 'go-git-it'
import * as messages from './messages'
import {downloadAndExtractZip} from './extract-from-zip'

const isUrl = (url: string) => {
  try {
    // eslint-disable-next-line no-new
    new URL(url)
    return true
  } catch (e) {
    return false
  }
}

async function importUrlSourceFromGithub(
  pathOrRemoteUrl: string,
  text: string
) {
  const goGitIt = goGitItLib.default
  await goGitIt(pathOrRemoteUrl, process.cwd(), text)

  return path.resolve(process.cwd(), path.basename(pathOrRemoteUrl))
}

async function importUrlSourceFromZip(pathOrRemoteUrl: string) {
  const zipFilePath = await downloadAndExtractZip(
    pathOrRemoteUrl,
    process.cwd()
  )

  return zipFilePath
  // return path.resolve(process.cwd(), path.basename(pathOrRemoteUrl))
}

export async function getProjectPath(pathOrRemoteUrl: string | undefined) {
  if (!pathOrRemoteUrl) {
    return process.cwd()
  }

  if (isUrl(pathOrRemoteUrl)) {
    const url = new URL(pathOrRemoteUrl)

    if (url.protocol.startsWith('http')) {
      if (url.origin !== 'https://github.com') {
        const urlSource = await importUrlSourceFromZip(pathOrRemoteUrl)

        return urlSource
      }

      const urlData = url.pathname.split('/')
      const owner = urlData.slice(1, 3)[0]
      const project = urlData.slice(1, 3)[1]

      console.log(messages.fetchingProjectPath(owner, project))

      const projectName = path.basename(url.pathname)

      const urlSource = await importUrlSourceFromGithub(
        pathOrRemoteUrl,
        messages.downloadingProjectPath(projectName)
      )

      console.log(messages.creatingProjectPath(projectName))

      return urlSource
    }
  }

  return path.resolve(process.cwd(), pathOrRemoteUrl)
}

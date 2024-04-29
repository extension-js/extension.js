// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import goGitIt from 'go-git-it'
import {blue, green, white, bold, underline} from '@colors/colors/safe'
import downloadAndExtractZip from './extractFromZip'

async function importUrlSourceFromGithub(
  pathOrRemoteUrl: string,
  text: string
) {
  await goGitIt(pathOrRemoteUrl, process.cwd(), text)

  return path.resolve(process.cwd(), path.basename(pathOrRemoteUrl))
}

async function importUrlSourceFromZip(pathOrRemoteUrl: string) {
  await downloadAndExtractZip(pathOrRemoteUrl, process.cwd())
  // remove all query params from url
  pathOrRemoteUrl = pathOrRemoteUrl.split('?')[0]

  return path.resolve(process.cwd(), path.basename(pathOrRemoteUrl))
}

export default async function getProjectPath(
  pathOrRemoteUrl: string | undefined
) {
  if (!pathOrRemoteUrl) {
    return process.cwd()
  }

  if (pathOrRemoteUrl.startsWith('http')) {
    if (!pathOrRemoteUrl.startsWith('https://github.com')) {
      const urlSource = await importUrlSourceFromZip(pathOrRemoteUrl)

      return urlSource
    }

    const urlData = new URL(pathOrRemoteUrl).pathname.split('/')
    const owner = urlData.slice(1, 3)[0]
    const project = urlData.slice(1, 3)[1]
    const projectName = path.basename(pathOrRemoteUrl)
    console.log(
      `🧩 ${bold(`Extension`)} ${green(`►►►`)} Fetching data from ${blue(
        underline(`https://github.com/${owner}/${project}`)
      )}`
    )
    const downloadingText = `🧩 ${bold(`extension`)} ${green(
      `►►►`
    )} Downloading ${bold(projectName)}...`
    const urlSource = await importUrlSourceFromGithub(
      pathOrRemoteUrl,
      downloadingText
    )
    console.log(
      `🧩 ${bold(`Extension`)} ${green(
        `►►►`
      )} Creating a new browser extension in ${white(
        underline(`${process.cwd()}/${projectName}`)
      )}`
    )

    return urlSource
  }

  return path.resolve(process.cwd(), pathOrRemoteUrl)
}

//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {fileURLToPath} from 'url'
import * as fs from 'fs/promises'
import * as os from 'os'
import axios from 'axios'
import AdmZip from 'adm-zip'
import goGitIt from 'go-git-it'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

function getArchiveBaseName(url: string): string {
  const withoutQuery = url.split('?')[0]
  const fileName = path.basename(withoutQuery)

  if (!fileName.toLowerCase().endsWith('.zip')) return fileName

  return fileName.slice(0, -4)
}

async function getZipSourcePath(
  tempPath: string,
  templateUrl: string
): Promise<string> {
  const archiveBase = getArchiveBaseName(templateUrl)
  let entries: Array<{isDirectory: () => boolean; name: string}> = []

  try {
    entries = await fs.readdir(tempPath, {withFileTypes: true})
  } catch {
    return tempPath
  }

  const dirs = entries.filter((entry) => entry.isDirectory())
  if (dirs.length !== 1) return tempPath

  const onlyDir = dirs[0]
  // Common release archives wrap files in <name>.<browser>/.
  if (onlyDir.name === archiveBase) return path.join(tempPath, onlyDir.name)
  return tempPath
}

export async function importExternalTemplate(
  projectPath: string,
  projectName: string,
  template: string
) {
  const templateName = path.basename(template)
  const examplesUrl =
    'https://github.com/extension-js/examples/tree/main/examples'
  // "init" is the canonical alias for the JavaScript starter template.
  // Keep this mapping consistent for both local (dev) and remote (production) installs.
  const resolvedTemplate = templateName === 'init' ? 'javascript' : template
  const resolvedTemplateName =
    templateName === 'init' ? 'javascript' : templateName
  const templateUrl = `${examplesUrl}/${resolvedTemplate}`
  try {
    // Ensure the project path exists
    await fs.mkdir(projectPath, {recursive: true})
    // Create a temporary directory for fetching remote templates
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'extension-js-create-')
    )
    const tempPath = path.join(tempRoot, projectName + '-temp')
    await fs.mkdir(tempPath, {recursive: true})

    const isHttp = /^https?:\/\//i.test(template)
    const isGithub = /^https?:\/\/github.com\//i.test(template)

    const runGoGitIt = async (templatePath: string, destination: string) => {
      await goGitIt(
        templatePath,
        destination,
        messages.installingFromTemplate(projectName, templateName)
      )
    }

    if (isGithub) {
      await runGoGitIt(template, tempPath)
      // If a subfolder exists matching the last path segment, use it; otherwise copy from tempPath
      const candidates = await fs.readdir(tempPath, {withFileTypes: true})
      const preferred = candidates.find(
        (d) => d.isDirectory() && d.name === templateName
      )
      const srcPath = preferred ? path.join(tempPath, templateName) : tempPath
      await utils.moveDirectoryContents(srcPath, projectPath)
    } else if (isHttp) {
      // Download zip and extract
      const {data, headers} = await axios.get(template, {
        responseType: 'arraybuffer',
        maxRedirects: 5
      })
      const contentType = String(headers?.['content-type'] || '')
      const looksZip =
        /zip|octet-stream/i.test(contentType) ||
        template.toLowerCase().endsWith('.zip')
      if (!looksZip) {
        throw new Error(
          `Remote template does not appear to be a ZIP archive: ${template}`
        )
      }
      const zip = new AdmZip(Buffer.from(data))
      zip.extractAllTo(tempPath, true)
      const sourcePath = await getZipSourcePath(tempPath, template)
      await utils.moveDirectoryContents(sourcePath, projectPath)
    } else {
      // Built-in template names resolve to extension-js/examples tree.
      await runGoGitIt(templateUrl, tempPath)
      const srcPath = path.join(tempPath, resolvedTemplateName)
      await utils.moveDirectoryContents(srcPath, projectPath)
    }

    // Cleanup temp
    await fs.rm(tempRoot, {recursive: true, force: true})
  } catch (error: any) {
    console.error(
      messages.installingFromTemplateError(projectName, templateName, error)
    )
    throw error
  }
}

//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs/promises'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'
import {findManifestJsonPath} from '../lib/find-manifest-json'

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function writeReadmeFile(
  projectPath: string,
  projectName: string,
  logger: {log(...args: any[]): void; error(...args: any[]): void}
) {
  // Always overwrite the template's README so the scaffolded project
  // reads as the user's own — not the upstream template's marketing
  // README. The bulk script in the examples repo keeps those rich,
  // template-specific READMEs for browsing on GitHub.

  const installCommand = await utils.getInstallCommand()
  const manifestJsonPath = await findManifestJsonPath(projectPath)
  const manifestJson = JSON.parse(await fs.readFile(manifestJsonPath, 'utf-8'))
  const description = String(manifestJson.description || '').trim()

  const screenshotPath = path.join(projectPath, 'public', 'screenshot.png')
  const hasScreenshot = await pathExists(screenshotPath)
  const screenshotEmbed = hasScreenshot
    ? `\n![screenshot](./public/screenshot.png)\n`
    : ''

  const blockquote = description ? `> ${description}\n\n` : ''

  const readme =
    `<a href="https://extension.js.org" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Powered%20by%20%7C%20Extension.js-0971fe" alt="Powered by Extension.js" align="right" /></a>\n` +
    `\n` +
    `# ${projectName}\n` +
    `\n` +
    blockquote +
    `${screenshotEmbed}` +
    `## Commands\n` +
    `\n` +
    `### dev\n` +
    `\n` +
    `Run the extension in development mode. Target a browser with \`--browser\`:\n` +
    `\n` +
    `\`\`\`bash\n` +
    `${installCommand} run dev\n` +
    `${installCommand} run dev -- --browser=firefox\n` +
    `${installCommand} run dev -- --browser=edge\n` +
    `\`\`\`\n` +
    `\n` +
    `### build\n` +
    `\n` +
    `Build for production. Convenience scripts target each browser:\n` +
    `\n` +
    `\`\`\`bash\n` +
    `${installCommand} run build           # Chrome (default)\n` +
    `${installCommand} run build:firefox\n` +
    `${installCommand} run build:edge\n` +
    `\`\`\`\n` +
    `\n` +
    `### preview\n` +
    `\n` +
    `Preview the production build in the browser:\n` +
    `\n` +
    `\`\`\`bash\n` +
    `${installCommand} run preview\n` +
    `\`\`\`\n` +
    `\n` +
    `## Learn more\n` +
    `\n` +
    `[Extension.js docs](https://extension.js.org).\n`

  try {
    logger.log(messages.writingReadmeMetaData())
    await fs.mkdir(projectPath, {recursive: true})
    await fs.writeFile(path.join(projectPath, 'README.md'), readme)
  } catch (error: any) {
    logger.error(messages.writingReadmeMetaDataEError(projectName, error))
    throw error
  }
}

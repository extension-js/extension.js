//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {findManifestJsonPath} from '../lib/find-manifest-json'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'
import {isDenoRuntime} from '../lib/package-manager'
import * as utils from '../lib/utils'

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

// The docs host for the share and store flow comes from the environment, so
// an unset value writes no section at all.
export function platformDocsUrl(): string {
  return String(process.env.EXTENSION_DEV_DOCS_URL || '')
    .trim()
    .replace(/\/+$/, '')
}

function shipItSection(): string {
  const docs = platformDocsUrl()
  if (!docs) return ''
  return (
    `\n` +
    `## Ship it\n` +
    `\n` +
    `Building and running your extension is local and free. When you are ready ` +
    `to share a build or submit it to the stores, see the ` +
    `[publish overview](${docs}/publish/overview?utm_source=create-readme).\n`
  )
}

export async function writeReadmeFile(
  projectPath: string,
  projectName: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
) {
  // Always overwrite the template's README so the scaffold reads as the user's
  // own; the examples repo keeps the rich template READMEs for browsing.

  const installCommand = await utils.getInstallCommand()
  // Deno runs package.json scripts through `deno task <name>` and forwards
  // extra flags directly (no `--` separator), unlike `<pm> run <name> -- <flags>`.
  const deno = isDenoRuntime()
  const runPrefix = deno ? 'deno task' : `${installCommand} run`
  const argSeparator = deno ? '' : ' --'
  const manifestJsonPath = await findManifestJsonPath(projectPath)
  const manifestJson = JSON.parse(await fs.readFile(manifestJsonPath, 'utf-8'))
  const description = String(manifestJson.description || '').trim()

  const hasPublicScreenshot = await pathExists(
    path.join(projectPath, 'public', 'screenshot.png')
  )
  const hasRootScreenshot = await pathExists(
    path.join(projectPath, 'screenshot.png')
  )
  const screenshotHref = hasPublicScreenshot
    ? './public/screenshot.png'
    : hasRootScreenshot
      ? './screenshot.png'
      : null
  const screenshotEmbed = screenshotHref
    ? `\n![screenshot](${screenshotHref})\n`
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
    `${runPrefix} dev\n` +
    `${runPrefix} dev${argSeparator} --browser=firefox\n` +
    `${runPrefix} dev${argSeparator} --browser=edge\n` +
    `\`\`\`\n` +
    `\n` +
    `### build\n` +
    `\n` +
    `Build for production. Convenience scripts target each browser:\n` +
    `\n` +
    `\`\`\`bash\n` +
    `${runPrefix} build           # Chromium (default)\n` +
    `${runPrefix} build:firefox\n` +
    `${runPrefix} build:edge\n` +
    `\`\`\`\n` +
    `\n` +
    `### preview\n` +
    `\n` +
    `Preview the production build in the browser:\n` +
    `\n` +
    `\`\`\`bash\n` +
    `${runPrefix} preview\n` +
    `\`\`\`\n` +
    `\n` +
    `## Learn more\n` +
    `\n` +
    `[Extension.js docs](https://extension.js.org).\n` +
    shipItSection()

  try {
    if (isDebug()) logger.log(messages.writingReadmeMetaData())
    await fs.mkdir(projectPath, {recursive: true})
    await fs.writeFile(path.join(projectPath, 'README.md'), readme)
  } catch (error) {
    logger.error(messages.writingReadmeMetaDataError(error))
    throw error
  }
}

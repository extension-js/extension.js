//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as path from 'path'
import * as fs from 'fs/promises'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

export async function writeReadmeFile(
  projectPath: string,
  projectName: string
) {
  // If a README already exists in the target folder, do not overwrite it
  try {
    await fs.access(path.join(projectPath, 'README.md'))
    // README exists; respect the existing file
    return
  } catch {}

  const initTemplateReadme = `
<a href="https://extension.js.org" target="_blank"><img src="https://img.shields.io/badge/Powered%20by%20%7C%20Extension.js-0971fe" alt="Powered by Extension.js" align="right" /></a>

# [projectName]

> [templateDescription]

What this example does in the scope of a browser extension. The description should 
describe for an audience of developers looking to use the example. Avoid jargon and 
use simple language.

## Installation

\`\`\`bash
[runCommand] create <project-name> --template init
cd <project-name>
npm install
\`\`\`

## Commands

### dev

Run the extension in development mode.

\`\`\`bash
[runCommand] dev
\`\`\`

### build

Build the extension for production.

\`\`\`bash
[runCommand] build
\`\`\`

### Preview

Preview the extension in the browser.

\`\`\`bash
[runCommand] preview
\`\`\`

## Learn more

Learn more about this and other examples at @https://extension.js.org/
  `

  const installCommand = await utils.getInstallCommand()
  const manifestJsonPath = path.join(projectPath, 'manifest.json')
  const manifestJson = JSON.parse(await fs.readFile(manifestJsonPath, 'utf-8'))

  const readmeFileEdited = initTemplateReadme
    .replaceAll('[projectName]', projectName)
    .replaceAll('[templateDescription]', manifestJson.description)
    .replaceAll('[runCommand]', installCommand)

  try {
    console.log(messages.writingReadmeMetaData())

    // Ensure path to project exists
    await fs.mkdir(projectPath, {recursive: true})
    await fs.writeFile(path.join(projectPath, 'README.md'), readmeFileEdited)
  } catch (error: any) {
    console.error(messages.writingReadmeMetaDataEError(projectName, error))
    throw error
  }
}

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
<a href="https://extension.js.org" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Powered%20by%20%7C%20Extension.js-0971fe" alt="Powered by Extension.js" align="right" /></a>

# [projectName]

> [templateDescription]

This project was created with Extension.js. Use the commands below to run and build it.

## Installation

\`\`\`bash
[runCommand] create <project-name> --template init
cd <project-name>
npm install
\`\`\`

## Commands

### dev

Run the extension in development mode. You can target a specific browser using the
\`--browser <browser>\` flag. Supported values: \`chrome\`, \`firefox\`, \`edge\`.

\`\`\`bash
[runCommand] dev --browser chrome
# or
[runCommand] dev --browser firefox
# or
[runCommand] dev --browser edge
\`\`\`

### build

Build the extension for production. Use \`--browser <browser>\` to select a target.

\`\`\`bash
[runCommand] build (defaults to Chrome)
# or use convenience scripts
[runCommand] build:firefox (Firefox)
[runCommand] build:edge (Edge)
\`\`\`

### Preview

Preview the extension in the browser.

\`\`\`bash
[runCommand] preview
\`\`\`

## Learn more

Learn more in the [Extension.js docs](https://extension.js.org).
  `

  const installCommand = await utils.getInstallCommand()
  const manifestJsonPath = await findManifestJsonPath(projectPath)
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

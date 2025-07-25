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
  const initTemplateReadme = `
# [projectName]

> [templateDescription]

## Available Scripts

In the project directory, you can run the following scripts:

### [runCommand] dev

**Development Mode**: This command runs your extension in development mode. It will launch a new browser instance with your extension loaded. The page will automatically reload whenever you make changes to your code, allowing for a smooth development experience.

\`\`\`bash
[runCommand] dev
\`\`\`

### [runCommand] start

**Production Preview**: This command runs your extension in production mode. It will launch a new browser instance with your extension loaded, simulating the environment and behavior of your extension as it will appear once published.

\`\`\`bash
[runCommand] start
\`\`\`

### [runCommand] build

**Build for Production**: This command builds your extension for production. It optimizes and bundles your extension, preparing it for deployment to the target browser's store.

\`\`\`bash
[runCommand] build
\`\`\`

## Learn More

To learn more about creating cross-browser extensions with Extension.js, visit the [official documentation](https://extension.js.org).
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

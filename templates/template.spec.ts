import fs from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'
import {registerTemplateTests} from './shared-template-tests'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

function getTemplateDirs(): string[] {
  try {
    const entries = fs.readdirSync(ROOT, {withFileTypes: true})
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((dir) => fs.existsSync(path.join(ROOT, dir, 'package.json')))
  } catch {
    return []
  }
}

for (const dirName of getTemplateDirs()) {
  const dir = path.join(ROOT, dirName)
  registerTemplateTests({
    exampleDir: `templates/${dirName}`,
    dir,
    hostSelectors: ['[data-extension-root="true"]']
  })
}

import * as fs from 'node:fs'
import * as path from 'node:path'

// Text is written as it is. Anything else is written as JSON.
export type ProjectFile = string | Record<string, unknown> | unknown[]

export interface ExtensionProject {
  name?: string
  // Merged over the smallest manifest a browser installs.
  manifest?: Record<string, unknown>
  // Where the manifest goes, relative to the project root.
  manifestFile?: string
  // Merged over a private package.json. Pass false for a project without one.
  packageJson?: Record<string, unknown> | false
  // The expression extension.config.js exports, as source text.
  config?: string
  files?: Record<string, ProjectFile>
}

export function writeProjectFiles(
  root: string,
  files: Record<string, ProjectFile>
): void {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative)

    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(
      file,
      typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    )
  }
}

// One extension project in a folder the spec already owns. Returns the
// folder with its links resolved, which is the path the build prints.
export function writeExtensionProject(
  folder: string,
  project: ExtensionProject = {}
): string {
  const root = fs.realpathSync(folder)
  const name = project.name ?? 'spec-extension'
  const files: Record<string, ProjectFile> = {
    [project.manifestFile ?? 'manifest.json']: {
      manifest_version: 3,
      name,
      version: '1.0.0',
      ...project.manifest
    }
  }

  if (project.packageJson !== false) {
    files['package.json'] = {
      private: true,
      name,
      version: '0.0.0',
      ...project.packageJson
    }
  }

  if (project.config !== undefined) {
    files['extension.config.js'] = `module.exports = ${project.config}\n`
  }

  writeProjectFiles(root, {...files, ...project.files})

  return root
}

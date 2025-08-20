import * as path from 'path'
import * as fs from 'fs'
import ignore from 'ignore'
import glob from 'tiny-glob'
import AdmZip from 'adm-zip'
import slugify from 'slugify'
import {type BuildOptions} from './config-types'
import * as messages from './messages'

function sanitizeString(input: string): string {
  return slugify(input, {
    // replace spaces with dashes
    replacement: '-',
    // remove non-alphanumeric characters except spaces
    remove: /[^a-zA-Z0-9 ]/g,
    lower: true
  })
}

function getExtensionExtension(vendor: string, isSource?: boolean): string {
  if (isSource) {
    return 'zip'
  }

  switch (vendor) {
    case 'opera':
      return 'crx'
    case 'firefox':
      return 'xpi'
    default:
      return 'zip'
  }
}

function getPackageName(
  manifest: Record<string, string>,
  options: BuildOptions,
  projectDir: string
): string {
  const provided = options.zipFilename && sanitizeString(options.zipFilename)
  if (provided) return provided
  // Default to manifest name for user-facing artifact names
  const base = sanitizeString(manifest.name || path.basename(projectDir))
  return `${base}-${manifest.version}`
}

async function getFilesToZip(projectDir: string): Promise<string[]> {
  const gitignorePath = path.join(projectDir, '.gitignore')
  const gitignoreContent = fs.readFileSync(gitignorePath)
  const ig = ignore()

  if (gitignoreContent) {
    ig.add(gitignoreContent.toString())
  } else {
    console.log(messages.noGitIgnoreFound(projectDir))
  }

  const files: string[] = await glob('**/*', {
    cwd: projectDir,
    dot: true
  })
  return files.filter((file) => !ig.ignores(file))
}

export async function generateZip(
  projectDir: string,
  {browser = 'chrome', ...options}: BuildOptions
) {
  try {
    const distDir = path.join(projectDir, 'dist')
    const outputDir = path.join(distDir, browser)
    // We collect data from the projectDir if the user wants to zip the source files.
    const dataDir = options.zipSource ? projectDir : outputDir
    const manifestPath = path.join(dataDir, 'manifest.json')
    const manifest: Record<string, string> = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8')
    )
    const name = getPackageName(manifest, {browser, ...options}, projectDir)
    const ext = getExtensionExtension(browser, options.zipSource)
    // Dist zips are stored in dist/[browser]/[name].zip
    const distZipPath = path.join(outputDir, `${name}.${ext}`)
    // Source zips are stored in dist/[name]-source.zip
    const sourceZipPath = path.join(distDir, `${name}-source.${ext}`)

    if (options.zipSource) {
      console.log('')
      console.log(messages.packagingSourceFiles(sourceZipPath))

      const zip = new AdmZip()
      const files = await getFilesToZip(projectDir)
      files.forEach((file) => {
        zip.addLocalFile(path.join(projectDir, file), path.dirname(file))
      })
      zip.writeZip(sourceZipPath)
    }

    if (options.zip) {
      console.log('')
      console.log(messages.packagingDistributionFiles(distZipPath))

      const zip = new AdmZip()
      zip.addLocalFolder(outputDir)
      zip.writeZip(distZipPath)
    }

    if (options.zip && options.zipSource) {
      console.log('')
      console.log(
        messages.treeWithSourceAndDistFiles(
          browser,
          name,
          sourceZipPath,
          distZipPath
        )
      )
    } else if (options.zip) {
      console.log('')
      console.log(
        messages.treeWithDistFilesbrowser(name, ext, browser, distZipPath)
      )
    } else if (options.zipSource) {
      console.log('')
      console.log(
        messages.treeWithSourceFiles(name, ext, browser, sourceZipPath)
      )
    }
  } catch (error) {
    console.error(messages.failedToCompressError(error))
    throw error
  }
}

import path from 'path'
import fs from 'fs'
import ignore from 'ignore'
import glob from 'tiny-glob'
import AdmZip from 'adm-zip'
import slugify from 'slugify'
import {blue, white, yellow, bold, underline} from '@colors/colors/safe'
import {type BuildOptions} from '../../develop-types'

function readFileSync(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    return ''
  }
}

function sanitizeString(input: string): string {
  return slugify(input, {
    // replace spaces with dashes
    replacement: '-',
    // remove non-alphanumeric characters except spaces
    remove: /[^a-zA-Z0-9 ]/g,
    lower: true
  })
}

function getExtensionExtension(vendor: string): string {
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
  options: BuildOptions
): string {
  const sanitizedStr = sanitizeString(options.zipFilename || manifest.name)
  if (options.zipFilename) return sanitizedStr

  return `${sanitizedStr}-${manifest.version}`
}

function capitalizeBrowserName(browser: string): string {
  return browser.charAt(0).toUpperCase() + browser.slice(1)
}

async function getFilesToZip(projectDir: string): Promise<string[]> {
  const gitignorePath = path.join(projectDir, '.gitignore')
  const gitignoreContent = readFileSync(gitignorePath)
  const ig = ignore()

  if (gitignoreContent) {
    ig.add(gitignoreContent)
  } else {
    console.log(
      `No ${yellow(
        '.gitignore'
      )} found, zipping all the content inside ${underline(projectDir)}`
    )
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
    const manifest: Record<string, string> = require(
      path.join(dataDir, 'manifest.json')
    )
    const name = getPackageName(manifest, options)
    const ext = getExtensionExtension(browser)
    // Dist zips are stored in dist/[browser]/[name].zip
    const distZipPath = path.join(outputDir, `${name}.${ext}`)
    // Source zips are stored in dist/[name]-source.zip
    const sourceZipPath = path.join(distDir, `${name}-source.${ext}`)
    const capitalizedBrowser = capitalizeBrowserName(browser)

    if (options.zipSource) {
      console.log(
        `\nPackaging source files to ${white(underline(sourceZipPath))}. ` +
          `Files in ${yellow('.gitignore')} will be excluded...`
      )
      const zip = new AdmZip()
      const files = await getFilesToZip(projectDir)
      files.forEach((file) => {
        zip.addLocalFile(path.join(projectDir, file), path.dirname(file))
      })
      zip.writeZip(sourceZipPath)
    }

    if (options.zip) {
      console.log(
        `\nPackaging extension distribution files to ${white(
          underline(distZipPath)
        )}...`
      )

      const zip = new AdmZip()
      zip.addLocalFolder(outputDir)
      zip.writeZip(distZipPath)
    }

    if (options.zip && options.zipSource) {
      console.log(
        `\n${'📦 Package name:'} ${yellow(
          `${name}`
        )}, ${'Target Browser:'} ${`${capitalizedBrowser}`}` +
          `\n   ${'└─'} ${underline(`${sourceZipPath}`)} (source)` +
          `\n   ${'└─'} ${underline(`${distZipPath}`)} (distribution)`
      )
    } else if (options.zip) {
      console.log(
        `\n${'📦 Package name:'} ${yellow(
          `${name}.${ext}`
        )}, ${'Target Browser:'} ${`${capitalizedBrowser}`}` +
          `\n   ${'└─'} ${underline(`${distZipPath}`)} (distribution)`
      )
    } else if (options.zipSource) {
      console.log(
        `\n${'📦 Package name:'} ${yellow(
          `${name}-source.${ext}`
        )}, ${'Target Browser:'} ${`${capitalizedBrowser}`}` +
          `\n   ${'└─'} ${underline(`${sourceZipPath}`)} (source)`
      )
    }
  } catch (error) {
    console.error(
      `🧩 ${'Extension.js'} ${blue(
        '✖︎✖︎✖︎'
      )} Failed to compress extension package: ${error}`
    )
    throw error
  }
}

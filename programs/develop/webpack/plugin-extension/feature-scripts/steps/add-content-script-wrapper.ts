import * as path from 'path'
import * as fs from 'fs'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../webpack-types'
import {generateReactWrapperCode} from './react-content-script-wrapper'
import {generateVueWrapperCode} from './vue-content-script-wrapper'
import {generateSvelteWrapperCode} from './svelte-content-script-wrapper'
import {generatePreactWrapperCode} from './preact-content-script-wrapper'
import {generateTypeScriptWrapperCode} from './typescript-content-script-wrapper'
import {generateJavaScriptWrapperCode} from './javascript-content-script-wrapper'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    },
    mode: {
      type: 'string'
    },
    includeList: {
      type: 'object'
    },
    excludeList: {
      type: 'object'
    }
  }
}

function extractCSSImports(source: string): string[] {
  const cssImports: string[] = []

  // Split source into lines and process each line
  const lines = source.split('\n')

  // Match various CSS import patterns (excluding commented lines)
  const cssImportPatterns = [
    /^\s*import\s+['"]([^'"]*\.(?:css|scss|sass|less|module\.css))['"]/,
    /^\s*import\s+['"]([^'"]*\.(?:css|scss|sass|less|module\.css))['"]\s*;?\s*$/,
    /^\s*import\s+['"]([^'"]*\.(?:css|scss|sass|less|module\.css))['"]\s*from\s+['"][^'"]*['"]/
  ]

  for (const line of lines) {
    // Skip commented lines
    const trimmedLine = line.trim()
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
      continue
    }

    for (const pattern of cssImportPatterns) {
      const match = pattern.exec(line)
      if (match) {
        const cssPath = match[1]
        if (cssPath && !cssImports.includes(cssPath)) {
          cssImports.push(cssPath)
        }
      }
    }
  }

  return cssImports
}

function detectFramework(
  resourcePath: string,
  projectPath: string
): 'react' | 'vue' | 'svelte' | 'preact' | 'typescript' | 'javascript' | null {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json')

    if (!fs.existsSync(packageJsonPath)) {
      // Fallback to file extension detection if no package.json
      if (resourcePath.endsWith('.ts') && !resourcePath.endsWith('.d.ts')) {
        return 'typescript'
      }
      return 'javascript'
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const dependencies = packageJson.dependencies || {}
    const devDependencies = packageJson.devDependencies || {}
    const allDeps = {...dependencies, ...devDependencies}

    // Check for specific frameworks in dependencies
    if (allDeps['react'] || allDeps['@types/react']) {
      return 'react'
    }

    if (allDeps['vue'] || allDeps['@vue/runtime-core']) {
      return 'vue'
    }

    if (allDeps['svelte'] || allDeps['@svelte/runtime']) {
      return 'svelte'
    }

    if (allDeps['preact'] || allDeps['@preact/preset-vite']) {
      return 'preact'
    }

    // Check for TypeScript
    if (
      allDeps['typescript'] ||
      allDeps['@types/node'] ||
      resourcePath.endsWith('.ts') ||
      resourcePath.endsWith('.tsx')
    ) {
      return 'typescript'
    }

    // Default to JavaScript
    return 'javascript'
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.warn(
        '[Extension.js] Error detecting framework from package.json:',
        error
      )
    }

    // Fallback to file extension detection
    if (resourcePath.endsWith('.ts') && !resourcePath.endsWith('.d.ts')) {
      return 'typescript'
    }
    return 'javascript'
  }
}

/**
 * Generate framework-specific wrapper code
 */
function generateFrameworkWrapperCode(
  source: string,
  framework: string,
  resourcePath: string
): string {
  const fileName = path.basename(resourcePath, path.extname(resourcePath))
  const cssImports = extractCSSImports(source)

  if (process.env.EXTENSION_ENV === 'development') {
    console.log(
      `🔍 Detected ${framework} framework with CSS imports:`,
      cssImports
    )
  }

  // Generate React-specific wrapper code
  if (framework === 'react') {
    return generateReactWrapperCode(source, resourcePath)
  }

  if (framework === 'vue') {
    return generateVueWrapperCode(source, resourcePath)
  }

  if (framework === 'svelte') {
    return generateSvelteWrapperCode(source, resourcePath)
  }

  if (framework === 'preact') {
    return generatePreactWrapperCode(source, resourcePath)
  }

  if (framework === 'typescript') {
    return generateTypeScriptWrapperCode(source, resourcePath)
  }

  if (framework === 'javascript') {
    return generateJavaScriptWrapperCode(source, resourcePath)
  }

  // Fallback to TypeScript-compatible code for unknown frameworks
  return generateTypeScriptWrapperCode(source, resourcePath)
}

/**
 * Check if content script should use wrapper
 */
function shouldUseWrapper(
  source: string,
  manifest: any,
  projectPath: string,
  url: string
): boolean {
  // Check if the source has the 'use shadow-dom' directive
  const hasShadowDomDirective =
    source.includes("'use shadow-dom'") || source.includes('"use shadow-dom"')

  // Check if content scripts are configured
  if (!manifest.content_scripts) {
    return false
  }

  // Check if this file is referenced in any content script
  for (const contentScript of manifest.content_scripts) {
    if (!contentScript.js) continue

    for (const js of contentScript.js) {
      const absoluteUrl = path.resolve(projectPath, js as string)
      if (url.includes(absoluteUrl)) {
        // Only apply wrapper when the source explicitly opts-in
        // via the 'use shadow-dom' directive
        return hasShadowDomDirective
      }
    }
  }

  return false
}

export default function (this: LoaderContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  validate(schema, options, {
    name: 'scripts:add-content-script-wrapper',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)

  // Check if we should use the wrapper
  if (!shouldUseWrapper(source, manifest, projectPath, url)) {
    return source
  }

  // Detect framework and generate appropriate wrapper
  const framework = detectFramework(this.resourcePath, projectPath)

  if (framework) {
    const wrapperCode = generateFrameworkWrapperCode(
      source,
      framework,
      this.resourcePath
    )
    return wrapperCode
  }

  return source
}

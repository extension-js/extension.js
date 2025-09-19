import * as path from 'path'
import * as fs from 'fs'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../webpack-types'
import {generateReactWrapperCode} from '../wrappers/react'
// import {generateVueWrapperCode} from '../wrappers/vue'
// import {generateSvelteWrapperCode} from '../wrappers/svelte'
import {generatePreactWrapperCode} from '../wrappers/preact'
// import {generateTypeScriptWrapperCode} from '../wrappers/typescript'
// import {generateJavaScriptWrapperCode} from '../wrappers/javascript'

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

// Extract CSS URLs referenced via new URL('./styles.css', import.meta.url)
function extractCssUrlsViaNewURL(source: string): string[] {
  const matches: string[] = []
  const re =
    /new\s+URL\(\s*['"]([^'"]+\.(?:css|scss|sass|less))['"]\s*,\s*import\.meta\.url\s*\)/g
  let m
  while ((m = re.exec(source))) {
    if (m[1] && !matches.includes(m[1])) matches.push(m[1])
  }
  return matches
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
  const cssImports = Array.from(
    new Set([...extractCSSImports(source), ...extractCssUrlsViaNewURL(source)])
  )

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

  // if (framework === 'vue') {
  //   return generateVueWrapperCode(source, resourcePath)
  // }

  // if (framework === 'svelte') {
  //   return generateSvelteWrapperCode(source, resourcePath)
  // }

  if (framework === 'preact') {
    return generatePreactWrapperCode(source, resourcePath)
  }

  // if (framework === 'typescript') {
  //   return generateTypeScriptWrapperCode(source, resourcePath)
  // }

  // if (framework === 'javascript') {
  //   return generateJavaScriptWrapperCode(source, resourcePath)
  // }

  // // Fallback to TypeScript-compatible code for unknown frameworks
  // return generateTypeScriptWrapperCode(source, resourcePath)
  return source
}

/**
 * Check if content script should use wrapper
 */
function shouldUseWrapper(
  source: string,
  manifest: any,
  projectPath: string,
  requestUrl: string,
  resourcePathAbs: string
): boolean {
  // New contract: only apply wrapper when the user provides a default export
  // This lets us know which function to apply our rules to, and avoids
  // being invasive for legacy scripts without a default export.
  const hasDefaultExport = /\bexport\s+default\b/.test(source)
  if (!hasDefaultExport) return false

  // Apply wrapper only to files referenced by manifest.content_scripts
  if (!manifest.content_scripts) return false

  for (const contentScript of manifest.content_scripts) {
    if (!contentScript.js) continue
    for (const js of contentScript.js) {
      const absoluteUrl = path.resolve(projectPath, js as string)
      // Match by absolute filesystem path
      if (
        resourcePathAbs === absoluteUrl ||
        resourcePathAbs.includes(absoluteUrl)
      ) {
        return true
      }
      // Fallback: match by normalized request path substrings
      const normalizedReq = requestUrl.replace(/\\/g, '/')
      const normalizedAbs = absoluteUrl.replace(/\\/g, '/')
      if (normalizedReq.includes(normalizedAbs)) {
        return true
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

  // Bypass wrapper when explicitly requesting raw module (used by wrapper dynamic import)
  try {
    const req: string = (this as any).request || ''
    if (req.includes('__extensionjs_raw__=1')) {
      return source
    }
    // Generate an HMR-declined proxy when requested
    if (req.includes('__extensionjs_decline__=1')) {
      // Re-import the original resource path (absolute) and decline HMR for this proxy.
      const absFile = this.resourcePath
      const proxyCode = `
if (import.meta.webpackHot) {
  try { import.meta.webpackHot.decline() } catch {}
}
export { default as default, contentScript } from ${JSON.stringify(absFile)}
`
      return proxyCode
    }
  } catch {}

  // Check if we should use the wrapper
  if (
    !shouldUseWrapper(source, manifest, projectPath, url, this.resourcePath)
  ) {
    return source
  }

  // Detect framework and generate appropriate wrapper
  const framework = detectFramework(this.resourcePath, projectPath)

  if (framework) {
    const wrapperRaw = generateFrameworkWrapperCode(
      source,
      framework,
      this.resourcePath
    )
    // Use absolute resource path to avoid malformed './/' requests from urlToRequest
    const userRequest = this.resourcePath + '?__extensionjs_decline__=1'
    const placeholder = "'__EXTENSIONJS_USER_REQUEST__'"
    const wrapperCode = wrapperRaw.split(placeholder).join(JSON.stringify(userRequest))
    return wrapperCode
  }

  return source
}

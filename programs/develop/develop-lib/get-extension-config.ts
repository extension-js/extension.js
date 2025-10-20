import * as fs from 'fs'
import * as path from 'path'
import {pathToFileURL} from 'url'
import {createRequire} from 'module'
import * as os from 'os'
import dotenv from 'dotenv'
import {Configuration} from '@rspack/core'
import {BrowserConfig, FileConfig, DevOptions} from '../types/options'
import * as messages from './messages'

function preloadEnvFiles(projectDir: string) {
  try {
    const defaultsPath = path.join(projectDir, '.env.defaults')
    if (fs.existsSync(defaultsPath)) {
      dotenv.config({path: defaultsPath})
    }

    const envCandidates = ['.env.development', '.env.local', '.env']

    for (const filename of envCandidates) {
      const filePath = path.join(projectDir, filename)
      if (fs.existsSync(filePath)) {
        dotenv.config({path: filePath})
        break
      }
    }
  } catch {
    // Best-effort env loading for config stage
  }
}

async function loadConfigFile(configPath: string): Promise<FileConfig> {
  const absolutePath = path.resolve(configPath)
  const projectDir = path.dirname(absolutePath)

  // Preload env so extension.config.js can read process.env.*
  preloadEnvFiles(projectDir)

  try {
    // Prefer CommonJS loader for .cjs files
    if (absolutePath.endsWith('.cjs')) {
      const requireFn = createRequire(import.meta.url)
      const required = requireFn(absolutePath)
      return required?.default || required
    }

    // Try to load as ESM module first
    // If the file references import.meta.env, create a temporary shimmed copy
    let esmImportPath = absolutePath

    try {
      const originalContent = fs.readFileSync(absolutePath, 'utf-8')

      if (originalContent.includes('import.meta.env')) {
        const tmpDir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'extension-config-esm-')
        )
        const tmpPath = path.join(tmpDir, path.basename(absolutePath))

        const envObjectLiteral = JSON.stringify(
          Object.fromEntries(
            Object.entries(process.env).map(([k, v]) => [k, v])
          ),
          null,
          0
        )
        const shimHeader = `const __IMPORT_META_ENV__ = Object.freeze(${envObjectLiteral});\n`
        const replaced = originalContent.replace(
          /import\.meta\.env/g,
          '__IMPORT_META_ENV__'
        )
        fs.writeFileSync(tmpPath, `${shimHeader}${replaced}`, 'utf-8')
        esmImportPath = tmpPath
      }
    } catch {
      // best-effort shim; if reading fails, proceed without it
    }

    const module = await import(pathToFileURL(esmImportPath).href)
    return module.default || module
  } catch (err: unknown) {
    const error = err as Error
    // If ESM import fails, attempt CommonJS require for non-.mjs files
    try {
      if (!absolutePath.endsWith('.mjs')) {
        const requireFn = createRequire(import.meta.url)
        let required

        try {
          required = requireFn(absolutePath)
        } catch (requireErr: any) {
          // If Node refuses to require because it treats .js as ESM due to package.json "type": "module",
          // but the file content clearly uses CommonJS (e.g., references to require in ESM scope),
          // copy to a temporary .cjs file and require that instead.
          const message =
            String(error?.message || '') +
            ' ' +
            String(requireErr?.message || '')
          const looksLikeCommonJsInEsm =
            message.includes('require is not defined in ES module scope') ||
            message.includes('Cannot use import statement outside a module') ||
            message.includes('ERR_REQUIRE_ESM')

          if (looksLikeCommonJsInEsm) {
            const tmpDir = fs.mkdtempSync(
              path.join(os.tmpdir(), 'extension-config-')
            )
            const tmpCjsPath = path.join(
              tmpDir,
              path.basename(absolutePath, path.extname(absolutePath)) + '.cjs'
            )
            fs.copyFileSync(absolutePath, tmpCjsPath)
            required = requireFn(tmpCjsPath)
          } else {
            throw requireErr
          }
        }
        return required?.default || required
      }
    } catch {
      // fallthrough to JSON parse
    }

    // As a last resort, try to parse as JSON (for rare cases)
    try {
      const content = fs.readFileSync(absolutePath, 'utf-8')
      return JSON.parse(content)
    } catch (jsonErr: unknown) {
      throw new Error(
        `Failed to load config file: ${configPath}\nError: ${error.message || error}`
      )
    }
  }
}

export async function loadCustomWebpackConfig(projectPath: string) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')
  const moduleUserConfigPath = path.join(projectPath, 'extension.config.mjs')
  const commonJsUserConfigPath = path.join(projectPath, 'extension.config.cjs')

  const candidates = [
    userConfigPath,
    moduleUserConfigPath,
    commonJsUserConfigPath
  ]
  const configPath = candidates.find((p) => fs.existsSync(p))

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(configPath)
        if (userConfig && typeof userConfig.config === 'function') {
          return userConfig.config
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(messages.configLoadingError(configPath, error))
        throw err
      }
    }
  }

  return (config: Configuration) => config
}

export async function loadCommandConfig(
  projectPath: string,
  command: 'dev' | 'build' | 'start' | 'preview'
) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')
  const moduleUserConfigPath = path.join(projectPath, 'extension.config.mjs')
  const commonJsUserConfigPath = path.join(projectPath, 'extension.config.cjs')
  const candidates = [
    userConfigPath,
    moduleUserConfigPath,
    commonJsUserConfigPath
  ]
  const configPath = candidates.find((p) => fs.existsSync(p))

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(configPath)
        if (userConfig && userConfig.commands && userConfig.commands[command]) {
          return userConfig.commands[command]
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(messages.configLoadingError(configPath, error))
        throw err
      }
    }
  }

  return {}
}

export async function loadBrowserConfig(
  projectPath: string,
  browser: DevOptions['browser'] = 'chrome'
): Promise<BrowserConfig> {
  const userConfigPath = path.join(projectPath, 'extension.config.js')
  const moduleUserConfigPath = path.join(projectPath, 'extension.config.mjs')
  const commonJsUserConfigPath = path.join(projectPath, 'extension.config.cjs')
  const candidates = [
    userConfigPath,
    moduleUserConfigPath,
    commonJsUserConfigPath
  ]
  const configPath = candidates.find((p) => fs.existsSync(p))

  if (configPath) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(configPath)
        if (userConfig && userConfig.browser && userConfig.browser[browser]) {
          return userConfig.browser[browser]
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(messages.configLoadingError(configPath, error))
        throw err
      }
    }
  }

  return {
    browser: browser || 'chrome'
  }
}

let userMessageDelivered = false

export async function isUsingExperimentalConfig(projectPath: string) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')
  const moduleUserConfigPath = path.join(projectPath, 'extension.config.mjs')
  const commonJsUserConfigPath = path.join(projectPath, 'extension.config.cjs')
  const candidates = [
    userConfigPath,
    moduleUserConfigPath,
    commonJsUserConfigPath
  ]
  const configPath = candidates.find((p) => fs.existsSync(p))

  if (configPath) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingExperimentalConfig('extension.config.js'))
      }
      userMessageDelivered = true
    }
    return true
  }
  return false
}

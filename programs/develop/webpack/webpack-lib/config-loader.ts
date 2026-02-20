// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as vm from 'vm'
import {pathToFileURL} from 'url'
import {createRequire} from 'module'
import dotenv from 'dotenv'
import type {Configuration} from '@rspack/core'
import * as messages from './messages'
import type {BrowserConfig, FileConfig, DevOptions} from '../webpack-types'

function loadCommonJsConfigWithStableDirname(absolutePath: string) {
  const code = fs.readFileSync(absolutePath, 'utf-8')
  const dirname = path.dirname(absolutePath)
  const requireFn = createRequire(absolutePath)

  // Emulate Node's CJS wrapper so __filename/__dirname match the *real* file.
  // This avoids the old workaround of copying extension.config.js to a temp .cjs,
  // which breaks configs that compute paths using __dirname (e.g., profile paths).
  const module = {exports: {} as any}
  const exports = module.exports

  const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${code}\n})`
  const fn = new vm.Script(wrapped, {
    filename: absolutePath
  }).runInThisContext()

  // Execute config with correct filename/dirname.
  fn(exports, requireFn, module, absolutePath, dirname)
  return module.exports?.default || module.exports
}

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
            try {
              // Preferred: evaluate CommonJS config with stable __dirname/__filename.
              required = loadCommonJsConfigWithStableDirname(absolutePath)
            } catch {
              // Fallback: legacy behavior (temp copy + require). This may break __dirname,
              // but keeps compatibility for edge cases where vm evaluation fails.
              const tmpDir = fs.mkdtempSync(
                path.join(os.tmpdir(), 'extension-config-')
              )
              const tmpCjsPath = path.join(
                tmpDir,
                path.basename(absolutePath, path.extname(absolutePath)) + '.cjs'
              )
              fs.copyFileSync(absolutePath, tmpCjsPath)
              required = requireFn(tmpCjsPath)
            }
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
        // Support plain object configuration by merging on top of base
        if (
          userConfig &&
          userConfig.config &&
          typeof userConfig.config === 'object'
        ) {
          const partial = userConfig.config as Configuration
          return (config: Configuration) => {
            // NOTE: Keep `webpack-merge` out of the module top-level imports so
            // preview/run-only paths can load config logic without pulling it in.
            const requireFn = createRequire(import.meta.url)
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const {merge} = requireFn(
              'webpack-merge'
            ) as typeof import('webpack-merge')
            return merge(config, partial)
          }
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
        // Allow a top-level `extensions` key to apply to all commands, with
        // per-command overrides via `commands.<cmd>.extensions`.
        const baseExtensions =
          userConfig && (userConfig as any).extensions
            ? {extensions: (userConfig as any).extensions}
            : {}
        const baseTranspilePackages =
          userConfig && Array.isArray((userConfig as any).transpilePackages)
            ? {transpilePackages: (userConfig as any).transpilePackages}
            : {}
        const perCommand =
          userConfig && userConfig.commands && userConfig.commands[command]
            ? userConfig.commands[command]
            : {}
        return {
          ...baseExtensions,
          ...baseTranspilePackages,
          ...perCommand
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
        if (userConfig && userConfig.browser) {
          const browsers = userConfig.browser as Record<string, BrowserConfig>

          // Semantics:
          // - 'chromium' == managed Chromium (system or Puppeteer cache).
          //   It should NOT automatically adopt engine-based configs that
          //   expect an explicit binary path.
          // - 'chromium-based' == engine-based; requires a working chromiumBinary.
          //   It may fall back to 'chromium' for shared config when missing.
          // - Similarly for 'firefox' vs 'gecko-based'.
          if (browser === 'chromium-based') {
            // Prefer explicit engine-based config, then fall back to generic Chromium.
            if (browsers['chromium-based']) return browsers['chromium-based']
            if (browsers.chromium) return browsers.chromium
          } else if (browser === 'gecko-based') {
            // Prefer explicit engine-based config, then fall back to Firefox.
            if (browsers['gecko-based']) return browsers['gecko-based']
            if (browsers.firefox) return browsers.firefox
          } else {
            const direct = browsers[browser]
            if (direct) return direct
          }
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
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.isUsingExperimentalConfig('extension.config.js'))
      }
      userMessageDelivered = true
    }
    return true
  }
  return false
}

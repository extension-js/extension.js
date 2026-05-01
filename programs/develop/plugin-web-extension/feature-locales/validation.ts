// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {Compiler, Compilation} from '@rspack/core'
import * as messages from './messages'
import {pushCompilationError} from './compilation-error'
import {resolveLocalesFolder} from './get-locales'

export function validateLocales(
  compiler: Compiler,
  compilation: Compilation,
  manifestPath: string
): boolean {
  // Validate locales/default_locale consistency across browsers
  const projectRoot =
    (compiler.options.context as string | undefined) || undefined
  try {
    const manifestRaw = fs.readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestRaw) as Record<string, any>
    const defaultLocale = manifest?.default_locale

    const resolvedLocalesRoot = resolveLocalesFolder(manifestPath, projectRoot)
    const localesRoot =
      resolvedLocalesRoot || path.join(path.dirname(manifestPath), '_locales')
    const hasLocalesRoot = Boolean(resolvedLocalesRoot)

    // Project-root layout is the canonical placement (sibling of public/,
    // dist/, package.json — matches Chrome's view of the dist root). When
    // the resolver falls back to `<manifestDir>/_locales` instead, emit a
    // build WARNING so authors are nudged toward the canonical layout —
    // not a fatal error, since plenty of existing templates and external
    // projects still use the legacy nested layout and shouldn't break.
    if (projectRoot && resolvedLocalesRoot) {
      const manifestDir = path.dirname(manifestPath)
      const sameAsRoot =
        path.resolve(manifestDir) === path.resolve(projectRoot)
      const usedManifestDirFallback =
        !sameAsRoot &&
        path.resolve(resolvedLocalesRoot) ===
          path.resolve(path.join(manifestDir, '_locales'))

      if (usedManifestDirFallback) {
        const ErrorConstructor =
          (compiler as any)?.rspack?.WebpackError || Error
        const warning = new ErrorConstructor(
          messages.localesMustBeAtProjectRoot(
            resolvedLocalesRoot,
            path.join(projectRoot, '_locales')
          )
        )
        ;(warning as any).name = 'LocalesLayoutWarning'
        if (!compilation.warnings) compilation.warnings = []
        compilation.warnings.push(warning)
      }
    }

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        messages.localesIncludeSummary(
          true,
          hasLocalesRoot,
          typeof defaultLocale === 'string' ? defaultLocale : undefined
        )
      )
    }

    if (typeof defaultLocale === 'string' && defaultLocale.trim()) {
      if (!hasLocalesRoot) {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.log(
            messages.localesValidationDetected(
              'default_locale set but _locales missing'
            )
          )
        }
        pushCompilationError(
          compiler,
          compilation,
          'LocalesValidationError',
          messages.defaultLocaleSpecifiedButLocalesMissing(),
          'manifest.json'
        )
        return false
      }

      const defaultLocaleDir = path.join(localesRoot, defaultLocale)
      if (!fs.existsSync(defaultLocaleDir)) {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.log(
            messages.localesValidationDetected(
              `missing _locales/${defaultLocale}`
            )
          )
        }

        pushCompilationError(
          compiler,
          compilation,
          'LocalesValidationError',
          messages.defaultLocaleFolderMissing(defaultLocale),
          'manifest.json'
        )
        return false
      }

      const messagesJsonPath = path.join(defaultLocaleDir, 'messages.json')

      if (!fs.existsSync(messagesJsonPath)) {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.log(
            messages.localesValidationDetected(
              `missing _locales/${defaultLocale}/messages.json`
            )
          )
        }

        pushCompilationError(
          compiler,
          compilation,
          'LocalesValidationError',
          messages.defaultLocaleMessagesMissing(defaultLocale),
          'manifest.json'
        )
        return false
      }

      // Validate JSON of default locale messages
      try {
        const content = fs.readFileSync(messagesJsonPath, 'utf8')
        JSON.parse(content)
      } catch (e) {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.log(
            messages.localesValidationDetected(
              `invalid JSON in _locales/${defaultLocale}/messages.json`
            )
          )
        }

        pushCompilationError(
          compiler,
          compilation,
          'LocalesValidationError',
          messages.invalidMessagesJson(messagesJsonPath),
          'manifest.json'
        )
        return false
      }

      // Ensure all __MSG_*__ placeholders referenced in manifest exist in default locale
      try {
        const content = fs.readFileSync(messagesJsonPath, 'utf8')
        const dict = JSON.parse(content)

        const collectMsgKeys = (value: unknown, acc: Set<string>) => {
          if (typeof value === 'string') {
            // Allow placeholders anywhere a string is used
            const regex = /__MSG_([a-zA-Z0-9_]+)__/g
            let matches: RegExpExecArray | null

            while ((matches = regex.exec(value)) !== null) {
              const key = matches[1]
              if (key) acc.add(key)
            }
          } else if (Array.isArray(value)) {
            for (const item of value) {
              collectMsgKeys(item, acc)
            }
          } else if (value && typeof value === 'object') {
            for (const v of Object.values(value as Record<string, any>)) {
              collectMsgKeys(v, acc)
            }
          }
        }

        const referenced = new Set<string>()
        collectMsgKeys(manifest, referenced)

        for (const key of referenced) {
          const entry = dict?.[key]

          if (!entry || typeof entry.message !== 'string') {
            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                messages.localesValidationDetected(
                  `missing key "${key}" in default locale`
                )
              )
            }

            pushCompilationError(
              compiler,
              compilation,
              'LocalesValidationError',
              messages.missingManifestMessageKey(key, defaultLocale),
              'manifest.json'
            )
            return false
          }
        }
      } catch {
        // If scanning fails, do not crash; other validators handle JSON structure
      }
    } else if (hasLocalesRoot) {
      // _locales present but no default_locale in manifest: browsers reject the extension
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          messages.localesValidationDetected(
            '_locales present but no default_locale'
          )
        )
      }

      pushCompilationError(
        compiler,
        compilation,
        'LocalesValidationError',
        messages.localesPresentButNoDefaultLocale(),
        'manifest.json'
      )
      return false
    }
  } catch {
    // If manifest cannot be parsed, defer to manifest feature/other validators
  }

  // Validate all locale JSON files are syntactically valid
  try {
    const localesRoot = resolveLocalesFolder(manifestPath, projectRoot)

    if (localesRoot && fs.existsSync(localesRoot)) {
      const localeDirs = fs
        .readdirSync(localesRoot)
        .map((d) => path.join(localesRoot, d))
        .filter((p) => fs.statSync(p).isDirectory())

      for (const localeDir of localeDirs) {
        const msgPath = path.join(localeDir, 'messages.json')
        if (fs.existsSync(msgPath)) {
          try {
            const s = fs.readFileSync(msgPath, 'utf8')
            JSON.parse(s)
          } catch {
            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                messages.localesValidationDetected(`invalid JSON in ${msgPath}`)
              )
            }

            pushCompilationError(
              compiler,
              compilation,
              'LocalesValidationError',
              messages.invalidMessagesJson(msgPath),
              'manifest.json'
            )
            return false
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return true
}

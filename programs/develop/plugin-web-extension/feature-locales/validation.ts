// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation, Compiler} from '@rspack/core'
import {isDebug} from '../../lib/messaging'
import {stripBom} from '../../lib/parse-json-safe'
import {pushCompilationError} from './compilation-error'
import {resolveLocalesFolder} from './get-locales'
import * as messages from './messages'

export function validateLocales(
  compiler: Compiler,
  compilation: Compilation,
  manifestPath: string
): boolean {
  const projectRoot =
    (compiler.options.context as string | undefined) || undefined
  try {
    const manifestRaw = fs.readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(stripBom(manifestRaw)) as Record<
      string,
      unknown
    >
    const defaultLocale = manifest?.default_locale

    const resolvedLocalesRoot = resolveLocalesFolder(manifestPath, projectRoot)
    const localesRoot =
      resolvedLocalesRoot || path.join(path.dirname(manifestPath), '_locales')
    const hasLocalesRoot = Boolean(resolvedLocalesRoot)

    // Project-root _locales is the canonical placement; the <manifestDir>/_locales
    // fallback warns instead of failing so legacy layouts keep building.
    if (projectRoot && resolvedLocalesRoot) {
      const manifestDir = path.dirname(manifestPath)
      const sameAsRoot = path.resolve(manifestDir) === path.resolve(projectRoot)
      const usedManifestDirFallback =
        !sameAsRoot &&
        path.resolve(resolvedLocalesRoot) ===
          path.resolve(path.join(manifestDir, '_locales'))

      if (usedManifestDirFallback) {
        const ErrorConstructor =
          (compiler as {rspack?: {WebpackError?: typeof Error}} | undefined)
            ?.rspack?.WebpackError || Error
        const warning = new ErrorConstructor(
          messages.localesMustBeAtProjectRoot(
            resolvedLocalesRoot,
            path.join(projectRoot, '_locales')
          )
        )
        ;(warning as Error).name = 'LocalesLayoutWarning'
        if (!compilation.warnings) compilation.warnings = []
        compilation.warnings.push(warning)
      }
    }

    if (isDebug()) {
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
        if (isDebug()) {
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
        if (isDebug()) {
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
        if (isDebug()) {
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

      // Parse once and reuse for the placeholder scan below (this file used to be
      // read and JSON.parse'd twice in a row).
      let defaultLocaleMessages: Record<string, {message?: unknown} | undefined>

      try {
        const content = fs.readFileSync(messagesJsonPath, 'utf8')
        defaultLocaleMessages = JSON.parse(stripBom(content))
      } catch {
        if (isDebug()) {
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
        const dict = defaultLocaleMessages

        const collectMsgKeys = (value: unknown, acc: Set<string>) => {
          if (typeof value === 'string') {
            // Chrome allows @ in message names and closes the placeholder at the
            // first __, so the class carries @ and the run is lazy to match that.
            const regex = /__MSG_([A-Za-z0-9_@]+?)__/g
            let matches: RegExpExecArray | null

            while ((matches = regex.exec(value)) !== null) {
              const key = matches[1]
              if (key && !key.startsWith('@@')) acc.add(key)
            }
          } else if (Array.isArray(value)) {
            for (const item of value) {
              collectMsgKeys(item, acc)
            }
          } else if (value && typeof value === 'object') {
            for (const v of Object.values(value as Record<string, unknown>)) {
              collectMsgKeys(v, acc)
            }
          }
        }

        const referenced = new Set<string>()
        collectMsgKeys(manifest, referenced)

        for (const key of referenced) {
          const entry = dict?.[key]

          if (!entry || typeof entry.message !== 'string') {
            if (isDebug()) {
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
      } catch (error) {
        if (isDebug()) {
          console.log(
            messages.localesValidationDetected(
              `could not scan __MSG__ placeholders in _locales/${defaultLocale}/messages.json: ${String((error as Error)?.message || error)}`
            )
          )
        }
      }
    } else if (hasLocalesRoot) {
      // _locales present but no default_locale in manifest: browsers reject the extension
      if (isDebug()) {
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
  } catch (error) {
    if (isDebug()) {
      console.log(
        messages.localesValidationDetected(
          `manifest.json could not be read for locale validation, deferring to manifest validation: ${String((error as Error)?.message || error)}`
        )
      )
    }
  }

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
            JSON.parse(stripBom(s))
          } catch {
            if (isDebug()) {
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
  } catch (error) {
    if (isDebug()) {
      console.log(
        messages.localesValidationDetected(
          `could not scan _locales for JSON validity: ${String((error as Error)?.message || error)}`
        )
      )
    }
  }

  return true
}

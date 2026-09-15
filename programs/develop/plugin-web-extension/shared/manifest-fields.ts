// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {getManifestFieldsData} from 'browser-extension-manifest-fields'
import {
  filterKeysForThisBrowser,
  findDroppedVendorKeys
} from '../../lib/manifest-utils'
import {parseJsonSafe} from '../../lib/parse-json-safe'
import type {DevOptions, Manifest} from '../../types'
import {applyIndependentHtmlSurfaces} from './html-surfaces'

type ManifestFieldsData = ReturnType<typeof getManifestFieldsData>

// The fields package resolves prefixes itself and still gives chrome: and
// edge: the whole family, so it reads a copy this resolver already resolved.
function getFieldsOfResolvedManifest(
  manifest: Manifest,
  manifestPath: string,
  browser: DevOptions['browser']
): ManifestFieldsData {
  const copyDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extension-js-manifest-fields-')
  )
  try {
    const copyPath = path.join(copyDir, 'manifest.json')
    fs.writeFileSync(copyPath, JSON.stringify(manifest))
    const data = getManifestFieldsData({manifestPath: copyPath, browser})
    const context = path.dirname(manifestPath)
    // The package joins every path onto the copy's folder, never reads them.
    const rebaseNode = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return path.isAbsolute(value)
          ? path.join(context, path.relative(copyDir, value))
          : value
      }
      if (Array.isArray(value)) return value.map(rebaseNode)
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, rebaseNode(item)])
        )
      }
      return value
    }
    // Same shape in, same shape out, only path strings change.
    const rebase = <T>(value: T): T => rebaseNode(value) as T
    return {
      ...data,
      html: rebase(data.html),
      icons: rebase(data.icons),
      json: rebase(data.json),
      scripts: rebase(data.scripts),
      theme: rebase(data.theme)
    }
  } finally {
    fs.rmSync(copyDir, {recursive: true, force: true})
  }
}

// One view of the manifest fields for every consumer: the fields package
// output with the html surfaces the package folds together split back out.
export function getResolvedManifestFieldsData(options: {
  manifestPath: string
  browser?: DevOptions['browser']
}) {
  const data = getManifestFieldsData({
    manifestPath: options.manifestPath,
    browser: options.browser
  })
  try {
    const browser = options.browser || 'chrome'
    const source = parseJsonSafe(
      fs.readFileSync(options.manifestPath, 'utf-8')
    ) as Manifest
    const manifest = filterKeysForThisBrowser(source, browser) as Manifest
    // Locales come from the real folder, the copy has no _locales beside it.
    const fields = findDroppedVendorKeys(source, browser).length
      ? {
          ...getFieldsOfResolvedManifest(
            manifest,
            options.manifestPath,
            browser
          ),
          locales: data.locales
        }
      : data
    return {
      ...fields,
      html: applyIndependentHtmlSurfaces(
        (fields.html || {}) as Record<string, string | undefined>,
        manifest,
        path.dirname(options.manifestPath),
        options.browser
      )
    }
  } catch {
    // An unreadable manifest keeps the fields package view.
    return data
  }
}

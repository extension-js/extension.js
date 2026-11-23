// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {getManifestFieldsData} from 'browser-extension-manifest-fields'
import {readManifest} from '../../lib/manifest/source-manifest'
import {filterKeysForThisBrowser} from '../../lib/manifest-utils'
import type {DevOptions, Manifest} from '../../types'
import {
  dropWebkitUnsupportedKeys,
  omitWebkitDroppedEntries
} from '../feature-manifest/manifest-lib/filter-keys-safari'
import {findMistypedManifestFields} from '../feature-manifest/manifest-lib/sanitize-fatal-shapes'
import {applyIndependentHtmlSurfaces} from './html-surfaces'

type ManifestFieldsView = ReturnType<typeof getManifestFieldsData>

function readManifestForBrowser(options: {
  manifestPath: string
  browser?: DevOptions['browser']
}): Manifest | undefined {
  try {
    return filterKeysForThisBrowser(
      readManifest(options.manifestPath, {emptyAsObject: true}),
      options.browser || 'chrome'
    ) as Manifest
  } catch {
    return undefined
  }
}

const packageViews = new WeakMap<object, Map<string, ManifestFieldsView>>()

// The fields package reads the manifest file itself on every call. Its view
// follows the manifest, the browser and the names under _locales only.
function readPackageFieldsView(options: {
  manifestPath: string
  browser?: DevOptions['browser']
}): ManifestFieldsView {
  const fromPackage = () =>
    getManifestFieldsData({
      manifestPath: options.manifestPath,
      browser: options.browser
    })
  let source: unknown
  let locales: string

  try {
    source = readManifest(options.manifestPath, {emptyAsObject: true})
    locales = fs
      .readdirSync(path.join(path.dirname(options.manifestPath), '_locales'), {
        recursive: true
      })
      .join('\n')
  } catch {
    locales = ''
  }

  if (!source || typeof source !== 'object') return fromPackage()

  const views = packageViews.get(source) ?? new Map()
  packageViews.set(source, views)

  const key = `${options.browser || 'chrome'}\n${locales}`
  if (!views.has(key)) views.set(key, fromPackage())

  return structuredClone(views.get(key) as ManifestFieldsView)
}

// A mistyped list field would throw a TypeError inside the fields package
// before any compilation exists; an empty view lets the manifest step refuse it.
function emptyManifestFieldsView(): ManifestFieldsView {
  return {
    html: {},
    icons: {},
    json: {},
    locales: undefined,
    scripts: {},
    web_accessible_resources: undefined,
    theme: undefined,
    semantic: undefined
  } as unknown as ManifestFieldsView
}

// One view of the manifest fields for every consumer: the fields package
// output with the html surfaces the package folds together split back out.
export function getResolvedManifestFieldsData(options: {
  manifestPath: string
  browser?: DevOptions['browser']
  projectPath?: string
}) {
  const manifest = readManifestForBrowser(options)
  const data =
    manifest && findMistypedManifestFields(manifest).length > 0
      ? emptyManifestFieldsView()
      : readPackageFieldsView(options)

  // An unreadable manifest keeps the fields package view.
  if (!manifest) return data

  try {
    // Safari ships none of the keys its filter drops, so the entries are read
    // from the manifest that filter leaves behind.
    const webkit = dropWebkitUnsupportedKeys(
      manifest,
      options.browser || 'chrome'
    )

    return {
      ...data,
      html: omitWebkitDroppedEntries(
        applyIndependentHtmlSurfaces(
          (data.html || {}) as Record<string, string | undefined>,
          webkit.manifest,
          path.dirname(options.manifestPath),
          options.browser,
          options.projectPath
        ),
        webkit.dropped
      ),
      icons: omitWebkitDroppedEntries(data.icons, webkit.dropped),
      json: omitWebkitDroppedEntries(data.json, webkit.dropped),
      scripts: omitWebkitDroppedEntries(data.scripts, webkit.dropped)
    }
  } catch {
    return data
  }
}

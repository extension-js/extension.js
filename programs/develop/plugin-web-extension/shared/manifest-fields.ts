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
import {filterKeysForThisBrowser} from '../../lib/manifest-utils'
import {parseJsonSafe} from '../../lib/parse-json-safe'
import type {DevOptions, Manifest} from '../../types'
import {findMistypedManifestFields} from '../feature-manifest/manifest-lib/sanitize-fatal-shapes'
import {applyIndependentHtmlSurfaces} from './html-surfaces'

type ManifestFieldsView = ReturnType<typeof getManifestFieldsData>

function readManifestForBrowser(options: {
  manifestPath: string
  browser?: DevOptions['browser']
}): Manifest | undefined {
  try {
    return filterKeysForThisBrowser(
      parseJsonSafe(fs.readFileSync(options.manifestPath, 'utf-8')) as Manifest,
      options.browser || 'chrome'
    ) as Manifest
  } catch {
    return undefined
  }
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
      : getManifestFieldsData({
          manifestPath: options.manifestPath,
          browser: options.browser
        })

  // An unreadable manifest keeps the fields package view.
  if (!manifest) return data

  try {
    return {
      ...data,
      html: applyIndependentHtmlSurfaces(
        (data.html || {}) as Record<string, string | undefined>,
        manifest,
        path.dirname(options.manifestPath),
        options.browser,
        options.projectPath
      )
    }
  } catch {
    return data
  }
}

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
import {applyIndependentHtmlSurfaces} from './html-surfaces'

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
    const manifest = filterKeysForThisBrowser(
      parseJsonSafe(fs.readFileSync(options.manifestPath, 'utf-8')) as Manifest,
      options.browser || 'chrome'
    ) as Manifest
    return {
      ...data,
      html: applyIndependentHtmlSurfaces(
        (data.html || {}) as Record<string, string | undefined>,
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

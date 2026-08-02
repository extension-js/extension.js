// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, WebpackError} from '@rspack/core'
import type {FilepathList, PluginInterface} from '../../../types'
import * as messages from '../html-lib/messages'
import {getAssetsFromHtml} from '../html-lib/utils'

export class ThrowIfRecompileIsNeeded {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string

  private initialHtmlAssets: Record<string, {js: string[]; css: string[]}> = {}

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser
  }

  private hasEntriesChanged(
    updatedEntries: string[] | undefined,
    prevEntries: string[] | undefined
  ): boolean {
    if (!prevEntries || !updatedEntries) return true

    if (updatedEntries.length !== prevEntries.length) return true

    for (let i = 0; i < updatedEntries.length; i++) {
      if (updatedEntries[i] !== prevEntries[i]) {
        return true
      }
    }
    return false
  }

  private storeInitialHtmlAssets(htmlFields: Record<string, unknown>) {
    Object.entries(htmlFields).forEach(([key, resource]) => {
      if (typeof resource !== 'string') {
        return
      }

      const htmlFile = resource

      if (!fs.existsSync(htmlFile)) {
        // Do not exit here; manifest feature is responsible for failing on
        // entrypoint errors. This step should not terminate the process.
        return
      }

      const isRemoteUrl = (p: string) => /^(https?:)?\/\//i.test(p)
      const looksLikePublicRootUrl = (p: string) =>
        p.startsWith('/') && !fs.existsSync(p)

      const initialJs = (getAssetsFromHtml(htmlFile)?.js || []).filter(
        (p) => !looksLikePublicRootUrl(p) && !isRemoteUrl(p)
      )
      const initialCss = (getAssetsFromHtml(htmlFile)?.css || []).filter(
        (p) => !looksLikePublicRootUrl(p) && !isRemoteUrl(p)
      )

      this.initialHtmlAssets[htmlFile] = {
        js: initialJs,
        css: initialCss
      }
    })
  }

  public apply(compiler: Compiler): void {
    const htmlFields = this.includeList || {}

    this.storeInitialHtmlAssets(htmlFields)

    compiler.hooks.make.tapAsync(
      'html:throw-if-recompile-is-needed',
      (compilation, done) => {
        const files = compiler.modifiedFiles || new Set<string>()
        const changedFile = Array.from(files)[0]

        if (changedFile && this.initialHtmlAssets[changedFile]) {
          const isRemoteUrl = (p: string) => /^(https?:)?\/\//i.test(p)
          const looksLikePublicRootUrl = (p: string) =>
            p.startsWith('/') && !fs.existsSync(p)

          // A deleted HTML entry parses as no assets at all, which keeps the
          // restart warning below firing; getAssetsFromHtml throws on ENOENT.
          const updatedAssets = fs.existsSync(changedFile)
            ? getAssetsFromHtml(changedFile)
            : undefined
          const updatedJsEntries = (updatedAssets?.js || []).filter(
            (p) => !looksLikePublicRootUrl(p) && !isRemoteUrl(p)
          )
          const updatedCssEntries = (updatedAssets?.css || []).filter(
            (p) => !looksLikePublicRootUrl(p) && !isRemoteUrl(p)
          )

          const {js, css} = this.initialHtmlAssets[changedFile]

          if (
            this.hasEntriesChanged(updatedCssEntries, css) ||
            this.hasEntriesChanged(updatedJsEntries, js)
          ) {
            const projectRoot = path.dirname(this.manifestPath)
            const relToManifest = path.relative(projectRoot, changedFile)
            const err = new WebpackError(
              messages.serverRestartRequiredFromHtml(relToManifest, changedFile)
            ) as Error & {file?: string}
            err.name = 'HtmlEntrypointChanged'
            err.file = relToManifest
            compilation.errors.push(err)
          }
        }

        done()
      }
    )
  }
}

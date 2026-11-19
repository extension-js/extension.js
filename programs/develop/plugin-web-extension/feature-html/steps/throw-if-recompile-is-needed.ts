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
import {requestDevSessionRestart} from '../../../dev-server/session-restart'
import type {FilepathList, PluginInterface} from '../../../types'
import * as messages from '../html-lib/messages'
import {getAssetsFromHtml, missingPageEntryFiles} from '../html-lib/utils'

const isRemoteUrl = (ref: string) => /^(https?:)?\/\//i.test(ref)

// A root URL or a path with no file behind it is left out of the page
// entry. The win32 test reads both a drive path and a leading slash.
const hasNoFile = (ref: string) =>
  path.win32.isAbsolute(ref) && !fs.existsSync(ref)

const isEntryFile = (ref: string) => !hasNoFile(ref) && !isRemoteUrl(ref)

export class ThrowIfRecompileIsNeeded {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string

  private initialHtmlAssets: Record<string, {js: string[]; css: string[]}> = {}

  // Per page, the scripts and stylesheets it names that have no file yet.
  private missingEntryFiles: Record<string, string[]> = {}

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

  private storeInitialHtmlAssets(
    htmlFields: Record<string, unknown>,
    projectRoot: string
  ) {
    Object.entries(htmlFields).forEach(([, resource]) => {
      if (typeof resource !== 'string') {
        return
      }

      const htmlFile = resource

      if (!fs.existsSync(htmlFile)) {
        // Do not exit here; manifest feature is responsible for failing on
        // entrypoint errors. This step should not terminate the process.
        return
      }

      const initialJs = (getAssetsFromHtml(htmlFile)?.js || []).filter(
        isEntryFile
      )
      const initialCss = (getAssetsFromHtml(htmlFile)?.css || []).filter(
        isEntryFile
      )

      this.initialHtmlAssets[htmlFile] = {
        js: initialJs,
        css: initialCss
      }

      this.missingEntryFiles[htmlFile] = missingPageEntryFiles(
        htmlFile,
        projectRoot
      )
    })
  }

  public apply(compiler: Compiler): void {
    const htmlFields = this.includeList || {}

    const manifestDir = path.dirname(this.manifestPath)
    const entryRoot = (compiler.options?.context as string) || manifestDir

    this.storeInitialHtmlAssets(htmlFields, entryRoot)

    compiler.hooks.make.tapAsync(
      'html:throw-if-recompile-is-needed',
      (compilation, done) => {
        const files = compiler.modifiedFiles || new Set<string>()
        // Watch batches often land many paths at once (backup restore,
        // multi-save). Every page in the set must be inspected, not just the
        // first entry, or a changed page later in the batch never triggers
        // the restart warning.
        // Pages this build already asks a restart for, said once per page.
        const restartAsked = new Set<string>()

        for (const changedFile of files) {
          if (!this.initialHtmlAssets[changedFile]) continue

          // Re-read this page's bytes for the comparison. getAssetsFromHtml's
          // disk cache is keyed by mtime+size; backup restores can preserve
          // both while swapping <script>/<link> targets, which left the
          // browser on an uncompiled entry with no restart warning. Only
          // pages in this rebuild's modified set are re-read, untouched
          // pages keep the cache.
          let updatedAssets: ReturnType<typeof getAssetsFromHtml> | undefined

          try {
            updatedAssets = getAssetsFromHtml(
              changedFile,
              fs.readFileSync(changedFile, 'utf8')
            )
          } catch {
            // A deleted HTML entry compares as no assets at all, which keeps
            // the restart warning below firing.
            updatedAssets = undefined
          }

          const updatedJsEntries = (updatedAssets?.js || []).filter(isEntryFile)
          const updatedCssEntries = (updatedAssets?.css || []).filter(
            isEntryFile
          )

          // The page as it reads now decides which files are still awaited.
          try {
            this.missingEntryFiles[changedFile] = missingPageEntryFiles(
              changedFile,
              entryRoot,
              fs.readFileSync(changedFile, 'utf8')
            )
          } catch {
            this.missingEntryFiles[changedFile] = []
          }

          const {js, css} = this.initialHtmlAssets[changedFile]

          if (
            this.hasEntriesChanged(updatedCssEntries, css) ||
            this.hasEntriesChanged(updatedJsEntries, js)
          ) {
            const projectRoot = path.dirname(this.manifestPath)
            const relToManifest = path.relative(projectRoot, changedFile)

            restartAsked.add(changedFile)

            if (
              requestDevSessionRestart(compiler, {
                reason: 'html',
                pathAfter: changedFile,
                manifestField: relToManifest
              })
            ) {
              continue
            }

            const err = new WebpackError(
              messages.serverRestartRequiredFromHtml(changedFile)
            ) as Error & {file?: string}
            err.name = 'HtmlEntrypointChanged'
            err.file = relToManifest
            compilation.errors.push(err)
          }
        }

        // A file that was missing when its page became an entry exists now.
        // The entry was built without it, so only a new compiler can add it.
        for (const [htmlFile, awaited] of Object.entries(
          this.missingEntryFiles
        )) {
          const created = awaited.filter((file) => fs.existsSync(file))
          if (created.length === 0) continue

          this.missingEntryFiles[htmlFile] = awaited.filter(
            (file) => !created.includes(file)
          )

          if (restartAsked.has(htmlFile)) continue

          const relToManifest = path.relative(manifestDir, htmlFile)

          if (
            requestDevSessionRestart(compiler, {
              reason: 'html',
              pathAfter: created[0],
              manifestField: relToManifest
            })
          ) {
            continue
          }

          for (const file of created) {
            const err = new WebpackError(
              messages.serverRestartRequiredFromCreatedFile(htmlFile, file)
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

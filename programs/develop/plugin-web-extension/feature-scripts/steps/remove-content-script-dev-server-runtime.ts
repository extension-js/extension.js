import fs from 'fs'
import path from 'path'
import {Compilation, type Compiler, sources} from '@rspack/core'

const CONTENT_SCRIPT_ASSET =
  /(^|\/)content_scripts\/content-\d+(?:\.[a-f0-9]+)?\.js$/i
const DEV_SERVER_CLIENT_MARKERS = [
  '@rspack/dev-server/client/index.js?',
  '@rspack/dev-server/client/utils/ansiHTML.js',
  'webpack-dev-server',
  'WebSocketClient'
]
const DEV_SERVER_HOT_MARKERS = [
  '[HMR] Waiting for update signal from WDS...',
  '[HMR] Cannot find update. Need to do a full reload!',
  'module.hot.check()'
]

export class RemoveContentScriptDevServerRuntime {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      RemoveContentScriptDevServerRuntime.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: RemoveContentScriptDevServerRuntime.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (!CONTENT_SCRIPT_ASSET.test(asset.name)) continue

              const originalSource = asset.source.source().toString()
              const strippedSource =
                stripDevServerStartupFromContentScript(originalSource)

              if (strippedSource === originalSource) continue

              compilation.updateAsset(
                asset.name,
                new sources.RawSource(strippedSource)
              )
            }
          }
        )
      }
    )

    compiler.hooks.afterEmit.tap(
      RemoveContentScriptDevServerRuntime.name,
      (compilation) => {
        for (const asset of compilation.getAssets()) {
          if (!CONTENT_SCRIPT_ASSET.test(asset.name)) continue

          const outputPath = path.join(
            compilation.outputOptions.path || '',
            asset.name
          )

          if (!outputPath || !fs.existsSync(outputPath)) continue

          const originalSource = fs.readFileSync(outputPath, 'utf-8')
          const strippedSource =
            stripDevServerStartupFromContentScript(originalSource)

          if (strippedSource !== originalSource) {
            fs.writeFileSync(outputPath, strippedSource, 'utf-8')
          }
        }
      }
    )

    compiler.hooks.done.tap(
      RemoveContentScriptDevServerRuntime.name,
      (stats) => {
        const outputPath = stats.compilation.outputOptions.path || ''
        if (!outputPath) return
        try {
          sanitizeOutputDirectory(outputPath)
        } catch {
          // Best-effort post-emit sanitization.
        }
      }
    )
  }
}

export function stripDevServerStartupFromContentScript(source: string): string {
  let nextSource = source
  const startupModuleIds = getStartupModuleIds(source)

  for (const moduleId of startupModuleIds) {
    const moduleBody = getModuleBody(source, moduleId)
    if (!moduleBody) continue

    const shouldStrip =
      DEV_SERVER_CLIENT_MARKERS.some((marker) => moduleBody.includes(marker)) ||
      DEV_SERVER_HOT_MARKERS.some((marker) => moduleBody.includes(marker))

    if (shouldStrip) {
      nextSource = stripStartupRequire(nextSource, moduleId)
    }
  }

  return stripExtraStartupRequires(nextSource)
}

function getStartupModuleIds(source: string): string[] {
  const startupIndex = source.indexOf('// startup')
  if (startupIndex === -1) return []

  const startupSection = source.slice(startupIndex)
  const requirePattern = /__webpack_require__\((\d+)\);/g
  const ids: string[] = []
  let match: RegExpExecArray | null = null

  while ((match = requirePattern.exec(startupSection))) {
    ids.push(match[1])
  }

  return ids
}

function getModuleBody(source: string, moduleId: string): string | null {
  const moduleHeaderPattern = new RegExp(
    `(?:^|\\n)${moduleId}\\([^)]*\\)\\s*\\{`,
    'm'
  )
  const headerMatch = moduleHeaderPattern.exec(source)
  if (!headerMatch) return null

  const moduleStart = headerMatch.index
  const nextHeaderPattern = /(?:^|\n)\d+\([^)]*\)\s*\{/g

  nextHeaderPattern.lastIndex = moduleStart + headerMatch[0].length
  const nextHeaderMatch = nextHeaderPattern.exec(source)

  return source.slice(
    moduleStart,
    nextHeaderMatch ? nextHeaderMatch.index : source.length
  )
}

function sanitizeOutputDirectory(outputPath: string) {
  const contentScriptsDir = path.join(outputPath, 'content_scripts')
  if (!fs.existsSync(contentScriptsDir)) return false

  let changed = false

  for (const fileName of fs.readdirSync(contentScriptsDir)) {
    if (!/^content-\d+(?:\.[a-f0-9]+)?\.js$/i.test(fileName)) continue

    const filePath = path.join(contentScriptsDir, fileName)
    const originalSource = fs.readFileSync(filePath, 'utf-8')
    const strippedSource =
      stripDevServerStartupFromContentScript(originalSource)

    if (strippedSource !== originalSource) {
      fs.writeFileSync(filePath, strippedSource, 'utf-8')
      changed = true
    }
  }

  return changed
}

function stripExtraStartupRequires(source: string) {
  const startupMarker = '// startup'
  const startupIndex = source.indexOf(startupMarker)

  if (startupIndex === -1) return source

  const startupSection = source.slice(startupIndex)
  const mainEntryMatch = startupSection.match(
    /var __webpack_exports__ = __webpack_require__\(\d+\);/
  )

  if (!mainEntryMatch) return source

  const requireMatches = Array.from(
    startupSection.matchAll(/^\s*__webpack_require__\(\d+\);\s*$/gm)
  )

  if (requireMatches.length <= 1) return source

  const requiresToRemove = requireMatches.slice(1).map((match) => match[0])
  let nextSource = source

  for (const requireLine of requiresToRemove) {
    nextSource = nextSource.replace(requireLine, '')
  }

  return nextSource
}

function stripStartupRequire(source: string, moduleId: string): string {
  const startupRequirePattern = new RegExp(
    `^\\s*__webpack_require__\\(${moduleId}\\);\\n?`,
    'm'
  )

  return source.replace(startupRequirePattern, '')
}

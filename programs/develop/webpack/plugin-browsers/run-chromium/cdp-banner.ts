import * as fs from 'fs'
import * as path from 'path'
import * as messages from '../browsers-lib/messages'

type BannerInfo = {extensionId: string; name?: string; version?: string}

export async function tryPrintBannerOnce(options: {
  outPath: string
  browser: string
  getInfo: () => Promise<BannerInfo | null>
}): Promise<boolean> {
  const info = await options.getInfo()
  if (!info) return false

  const manifestPath = path.join(options.outPath, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const name = info.name || manifest.name
  const version = info.version || manifest.version
  const message = {
    data: {
      id: info.extensionId,
      management: {name, version}
    }
  }

  console.log(messages.emptyLine())
  console.log(
    messages.runningInDevelopment(
      manifest,
      options.browser as 'chrome' | 'edge' | 'firefox',
      message as {
        data?: {id?: string; management?: {name?: string; version?: string}}
      }
    )
  )
  console.log(messages.emptyLine())

  return true
}

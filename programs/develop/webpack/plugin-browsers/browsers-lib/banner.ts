import * as fs from 'fs'
import * as path from 'path'
import * as messages from './messages'
import {markBannerPrinted} from '../../webpack-lib/shared-state'
import {DevOptions} from '../../types/options'

type Info = {extensionId: string; name?: string; version?: string} | null
type HostPort = {host?: string; port?: number | string}

const printedKeys = new Set<string>()

function keyFor(
  browser: DevOptions['browser'],
  outPath: string,
  hp?: HostPort
) {
  const host = (hp?.host || '127.0.0.1').toString()
  const port = hp?.port == null ? '' : String(hp.port)

  return `${browser}::${path.resolve(outPath)}::${host}:${port}`
}

export async function printDevBannerOnce(opts: {
  browser: DevOptions['browser']
  outPath: string
  hostPort?: HostPort
  getInfo: () => Promise<Info>
  fallback?: {name?: string; version?: string; extensionId?: string}
}) {
  const k = keyFor(opts.browser, opts.outPath, opts.hostPort)

  if (printedKeys.has(k)) return false

  const info = (await opts.getInfo()) || null
  const manifestPath = path.join(opts.outPath, 'manifest.json')

  if (!fs.existsSync(manifestPath)) return false

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const extensionId =
    info?.extensionId || opts.fallback?.extensionId || '(temporary)'
  const name = info?.name || opts.fallback?.name || manifest.name
  const version = info?.version || opts.fallback?.version || manifest.version

  const message = {
    data: {
      id: extensionId,
      management: {name, version}
    }
  }

  console.log(messages.emptyLine())
  console.log(messages.runningInDevelopment(manifest, opts.browser, message))
  console.log(messages.emptyLine())
  markBannerPrinted()

  printedKeys.add(k)
  return true
}

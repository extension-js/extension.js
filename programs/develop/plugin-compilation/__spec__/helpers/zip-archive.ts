import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {strFromU8, unzipSync} from 'fflate'
import {ZipPlugin} from '../../zip'

export function readZip(zipPath: string): Record<string, string> {
  const unzipped = unzipSync(new Uint8Array(fs.readFileSync(zipPath)))

  return Object.fromEntries(
    Object.entries(unzipped).map(([name, bytes]) => [name, strFromU8(bytes)])
  )
}

// The done stats the zip plugin reads: its compilation, where it reports
// warnings and records the archives it wrote.
export interface ZipDoneStats {
  compilation: {warnings: Error[]}
}

type DoneTap = (stats: ZipDoneStats) => Promise<unknown>

// A compiler with only the options and the done hook the zip plugin taps.
export function makeCompiler(ctx: string, outPath: string) {
  let doneCb: DoneTap | undefined
  const compiler = {
    options: {context: ctx, output: {path: outPath}},
    hooks: {
      done: {
        tapPromise: (_name: string, cb: DoneTap) => {
          doneCb = cb
        }
      }
    }
  }

  return {
    compiler: compiler as unknown as Compiler,
    emitDone: async (
      stats: ZipDoneStats = {compilation: {warnings: []}}
    ): Promise<ZipDoneStats> => {
      if (!doneCb) throw new Error('The zip plugin never tapped done')

      await doneCb(stats)

      return stats
    }
  }
}

export function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, contents)
}

export const BUILT_MANIFEST = JSON.stringify({name: 'Packed', version: '1.0.0'})

export function writeProject(root: string) {
  write(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'Packed', version: '1.0.0', manifest_version: 3})
  )

  write(path.join(root, 'src', 'background.ts'), 'export const a = 1')
}

export async function zipProject(
  root: string,
  outPath: string,
  zipData: {
    zip?: boolean
    zipSource?: boolean
    zipDir?: string
    zipFilename?: string
  },
  manifestPath = path.join(root, 'manifest.json')
) {
  const {compiler, emitDone} = makeCompiler(root, outPath)
  new ZipPlugin({
    browser: 'chrome',
    zipData,
    manifestPath
  }).apply(compiler)

  const stats = await emitDone()
  const warnings: string[] = stats.compilation.warnings.map((w: Error) =>
    String(w.message)
  )

  return {warnings}
}

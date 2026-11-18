import * as fs from 'node:fs'
import * as path from 'node:path'
import {strFromU8, unzipSync} from 'fflate'
import {ZipPlugin} from '../../zip'

export function readZip(zipPath: string): Record<string, string> {
  const unzipped = unzipSync(new Uint8Array(fs.readFileSync(zipPath)))

  return Object.fromEntries(
    Object.entries(unzipped).map(([name, bytes]) => [name, strFromU8(bytes)])
  )
}

function makeCompiler(ctx: string, outPath: string) {
  let doneCb: any
  const compiler: any = {
    options: {context: ctx, output: {path: outPath}},
    hooks: {
      done: {
        tapPromise: (_name: string, cb: any) => {
          doneCb = cb
        }
      }
    }
  }

  return {
    compiler,
    emitDone: async (stats: any = {compilation: {warnings: []}}) => {
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
  zipData: {zip?: boolean; zipSource?: boolean; zipDir?: string}
) {
  const {compiler, emitDone} = makeCompiler(root, outPath)
  new ZipPlugin({
    browser: 'chrome',
    zipData,
    manifestPath: path.join(root, 'manifest.json')
  }).apply(compiler)

  const stats = await emitDone()
  const warnings: string[] = stats.compilation.warnings.map((w: Error) =>
    String(w.message)
  )

  return {warnings}
}

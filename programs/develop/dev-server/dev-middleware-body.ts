//  ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
//  ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
//  ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
//  ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
//  ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
//  ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {ReadStream} from 'node:fs'
import type {IncomingMessage, ServerResponse} from 'node:http'
import * as path from 'node:path'

export interface OutputFileSystemLike {
  readFileSync?: (filePath: string) => Buffer
}

export interface ActiveCompilerRef {
  outputPath(): string | undefined
  outputFileSystem(): OutputFileSystemLike | undefined
}

type ResponseData = Buffer | ReadStream

interface ModifiedResponseData {
  data: ResponseData
  byteLength: number
}

// @rspack/dev-middleware 2.0.3 sizes a streamed body as `end === 0 ? 0 :
// end - start + 1`, a special case meant for an empty file that also catches
// a one-byte file, so that asset answers with Content-Length 0 and no body.
// A zero-length stream is reread from the output filesystem instead: an empty
// file stays empty and a one-byte file gets its byte back.
export function createResponseDataRepair(ref: ActiveCompilerRef) {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    data: ResponseData,
    byteLength: number
  ): ModifiedResponseData => {
    const untouched = {data, byteLength}

    if (byteLength !== 0) return untouched

    if (!data || Buffer.isBuffer(data)) return untouched

    // A ranged request can legitimately end at offset zero.
    if (req.headers.range || res.statusCode === 206) return untouched

    const outputPath = ref.outputPath()
    const outputFileSystem = ref.outputFileSystem()

    if (!outputPath || typeof outputFileSystem?.readFileSync !== 'function') {
      return untouched
    }

    const pathname = decodeURIComponent(
      String(req.url || '')
        .split('?')[0]
        .split('#')[0]
    )
    const filename = path.join(outputPath, pathname)

    if (!filename.startsWith(path.join(outputPath, path.sep))) return untouched

    let buffer: Buffer

    try {
      buffer = outputFileSystem.readFileSync(filename)
    } catch {
      return untouched
    }

    if (buffer.length === 0) return untouched

    if (typeof data.destroy === 'function') data.destroy()

    return {data: buffer, byteLength: buffer.length}
  }
}

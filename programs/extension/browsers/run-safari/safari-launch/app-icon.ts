// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {SafariBuildConfig} from '../safari-types'
import type {SafariPipelineTools} from './tools'

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
])
const APP_ICON_SET = 'AppIcon.appiconset'
export const APP_ICON_FULL_SIZE = 1024
const SEARCH_DEPTH = 4

interface IconSlot {
  size?: string
  scale?: string
  filename?: string
  [key: string]: unknown
}

export interface AppIconApplied {
  source: string
  sets: string[]
  files: number
  pixels: number
}

export function pngSize(file: string): {width: number; height: number} | null {
  try {
    const head = Buffer.alloc(24)
    const fd = fs.openSync(file, 'r')

    try {
      fs.readSync(fd, head, 0, 24, 0)
    } finally {
      fs.closeSync(fd)
    }

    if (!head.subarray(0, 8).equals(PNG_SIGNATURE)) return null
    if (head.subarray(12, 16).toString('ascii') !== 'IHDR') return null

    return {width: head.readUInt32BE(16), height: head.readUInt32BE(20)}
  } catch {
    return null
  }
}

// Where the converter leaves the icon set: <App>/<App>/Assets.xcassets for a
// macOS-only project, Shared (App)/Assets.xcassets for a universal one. The
// derived data folder holds build copies and is never a source.
export function findAppIconSets(root: string, depth = SEARCH_DEPTH): string[] {
  if (depth < 0) return []

  let entries: fs.Dirent[]

  try {
    entries = fs.readdirSync(root, {withFileTypes: true})
  } catch {
    return []
  }

  const found: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.derived') continue

    const full = path.join(root, entry.name)

    if (entry.name === APP_ICON_SET) found.push(full)
    else found.push(...findAppIconSets(full, depth - 1))
  }

  return found.sort()
}

function slotPixels(slot: IconSlot): number {
  const base = Number(String(slot.size || '').split('x')[0])
  const scale = Number(String(slot.scale || '1x').replace(/x$/, ''))

  return Number.isFinite(base) && Number.isFinite(scale)
    ? Math.round(base * scale)
    : 0
}

function slotFilename(slot: IconSlot, pixels: number): string {
  if (slot.filename) return String(slot.filename)

  return `app-icon-${String(slot.size || pixels)}@${String(slot.scale || '1x')}.png`
}

export function appIconProblem(source: string): string | null {
  const size = pngSize(source)

  if (!size) return `${source} is not a PNG image`

  if (size.width !== size.height) {
    return `${source} is ${size.width}x${size.height}, and the app icon must be square`
  }

  return null
}

// The supplied art goes into every slot as it is: the full-size slot gets the
// file byte for byte and every smaller slot a scaled copy, so no second plate
// is drawn around a tile the project already designed.
export async function applyAppIcon(
  config: SafariBuildConfig,
  tools: SafariPipelineTools
): Promise<AppIconApplied> {
  const source = String(config.appIcon || '')
  const problem = appIconProblem(source)

  if (problem) throw new Error(problem)

  const pixels = pngSize(source)?.width || 0
  const sets = findAppIconSets(
    path.join(config.projectLocation, config.appName)
  )
  let files = 0

  for (const set of sets) {
    const contentsFile = path.join(set, 'Contents.json')
    const contents = JSON.parse(fs.readFileSync(contentsFile, 'utf8')) as {
      images?: IconSlot[]
    }
    const images = Array.isArray(contents.images) ? contents.images : []
    const made = new Map<number, string>()

    for (const slot of images) {
      const size = slotPixels(slot)
      if (!size) continue

      const filename = slotFilename(slot, size)
      const out = path.join(set, filename)
      const earlier = made.get(size)

      if (size === pixels) fs.copyFileSync(source, out)
      else if (earlier) fs.copyFileSync(earlier, out)
      else {
        const resized = await tools.resizePng(source, out, size)

        if (!resized.ok) {
          throw new Error(
            `sips could not scale ${source} to ${size} px (exit ${resized.code})\n${resized.output}`
          )
        }
      }

      made.set(size, out)
      slot.filename = filename
      files += 1
    }

    fs.writeFileSync(contentsFile, `${JSON.stringify(contents, null, 2)}\n`)
  }

  return {source, sets, files, pixels}
}

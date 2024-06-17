// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'

export function getFileSize(fileSizeInBytes: number): string {
  return `${(fileSizeInBytes / 1024).toFixed(2)}KB`
}

export function getAssetsSize(assets: any[] | undefined) {
  let totalSize = 0
  assets?.forEach((asset) => {
    totalSize += asset.size
  })

  return getFileSize(totalSize)
}

function calculateDirectorySize(dirPath: string): number {
  let totalSize = 0

  const items = fs.readdirSync(dirPath)

  for (const item of items) {
    const fullPath = path.join(dirPath, item)
    const stats = fs.statSync(fullPath)

    if (stats.isFile()) {
      totalSize += stats.size
    } else if (stats.isDirectory()) {
      totalSize += calculateDirectorySize(fullPath)
    }
  }

  return totalSize
}

export default function getDirectorySize(filepath: string): string {
  const fileSizeInBytes = calculateDirectorySize(filepath)
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const sizeType = Math.floor(Math.log(fileSizeInBytes) / Math.log(1024))
  const size = (fileSizeInBytes / Math.pow(1024, sizeType)).toFixed(1)

  return `${size} ${sizes[sizeType]}`
}

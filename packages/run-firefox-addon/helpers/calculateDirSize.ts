import fs from 'fs'
import path from 'path'

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

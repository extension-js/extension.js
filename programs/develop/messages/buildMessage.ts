// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import type webpack from 'webpack'
import path from 'path'
import fs from 'fs'
import {yellow, green, bold, red, underline} from '@colors/colors/safe'
import {getAssetsSize, getFileSize} from './sizes'

// Function to recursively print the tree structure
export function printTree(node: Record<string, any>, prefix = '') {
  Object.keys(node).forEach((key, index, array) => {
    const isLast = index === array.length - 1
    const connector = isLast ? '└─' : '├─'
    const sizeInKB = node[key].size
      ? ` (${getFileSize(node[key].size as number)})`
      : ''
    console.log(`${prefix}${connector} ${bold(key)}${sizeInKB}`)
    if (typeof node[key] === 'object' && !node[key].size) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      printTree(node[key], `${prefix}${isLast ? '   ' : '|  '}`)
    }
  })
}

// • Filename: chrome_url_overrides/history.js, Size: 1.62KB
//   ▪ /Users/cezaraugusto/local/my-extensions/my-extension/chrome_url_overrides/history.js
// • Filename: chrome_url_overrides/history.css, Size: 1.23KB
//   ▪ /Users/cezaraugusto/local/my-extensions/my-extension/chrome_url_overrides/history.css
// • Filename: chrome_url_overrides/history.html, Size: 1.18KB
//   ▪ /Users/cezaraugusto/local/my-extensions/my-extension/chrome_url_overrides/history.html

export function getAssetInfo(
  outputPath: string,
  assets: Array<{name: string; size: number}> | undefined
) {
  console.log('\n')
  assets?.forEach((asset) => {
    const sizeInKB = getFileSize(asset.size)
    console.log(
      `• ${bold('Filename:')} ${yellow(asset.name)}, ${bold('Size:')} ${sizeInKB}` +
        `\n  ${bold('└─')} ${underline(`${path.join(outputPath, asset.name)}`)}`
    )
  })
}

export function getAssetsTree(assets: webpack.StatsAsset[] | undefined) {
  const assetTree: Record<string, {size: number}> = {}

  assets?.forEach((asset) => {
    const paths = asset.name.split('/')
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    let currentLevel: any = assetTree

    paths.forEach((part, index) => {
      if (!currentLevel[part]) {
        currentLevel[part] = {}
      }
      if (index === paths.length - 1) {
        // Last part of the path, add size info
        currentLevel[part] = {size: asset.size}
      } else {
        currentLevel = currentLevel[part]
      }
    })
  })

  console.log('.')
  printTree(assetTree)
}

export function buildWebpack(
  projectDir: string,
  stats: any,
  outputPath: string,
  browser: string
) {
  // Convert stats object to JSON format
  const statsJson = stats?.toJson()
  const manifestPath = path.join(projectDir, 'manifest.json')
  const manifest: Record<string, string> = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  )
  const assets: any[] = statsJson?.assets
  const heading = `🧩 ${bold('Extension.js')} ${green(
    '►►►'
  )} Building ${bold(manifest.name)} extension using ${bold(
    browser
  )} defaults...\n`
  const buildTime = `\nBuild completed in ${(
    (statsJson?.time || 0) / 1000
  ).toFixed(2)} seconds.`
  const buildStatus = `Build Status: ${
    stats?.hasErrors() ? red('Failed') : green('Success')
  }`
  const version = `Version: ${manifest.version}`
  const size = `Size: ${getAssetsSize(assets)}`

  console.log(heading)
  getAssetsTree(assets)
  getAssetInfo(outputPath, assets)
  console.log(buildTime)
  console.log(buildStatus)
  console.log(version)
  console.log(size)
}

export function ready() {
  console.log(
    green(
      '\nNo errors or warnings found. Your extension is ready for deployment.'
    )
  )
}

#!/usr/bin/env node
// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {fileURLToPath} from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Paths relative to this script's location
const buildDepsPath = path.join(
  __dirname,
  '../webpack/webpack-lib/build-dependencies.json'
)

try {
  // Validate that build-dependencies.json exists and is valid JSON
  if (!fs.existsSync(buildDepsPath)) {
    console.error(`Error: build-dependencies.json not found at ${buildDepsPath}`)
    process.exit(1)
  }

  const buildDeps = JSON.parse(fs.readFileSync(buildDepsPath, 'utf-8'))
  
  // Validate it's an object with dependencies
  if (typeof buildDeps !== 'object' || buildDeps === null || Array.isArray(buildDeps)) {
    throw new Error('build-dependencies.json must contain an object')
  }

  console.log(
    `✓ Validated build-dependencies.json (${Object.keys(buildDeps).length} dependencies)`
  )
} catch (error) {
  console.error('Error validating build-dependencies.json:', error.message)
  process.exit(1)
}

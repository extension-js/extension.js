// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {execFileSync} from 'child_process'

describe('sync-build-dependencies', () => {
  const testDir = path.join(__dirname, '../../.tmp-sync-test')
  const buildDepsPath = path.join(
    testDir,
    'webpack/webpack-lib/build-dependencies.json'
  )
  const syncScriptPath = path.join(
    __dirname,
    '../../scripts/sync-build-dependencies.mjs'
  )

  const originalBuildDeps = {
    '@rspack/dev-server': '^1.1.4',
    '@swc/core': '^1.13.2',
    'webpack-merge': '^6.0.1'
  }

  beforeEach(() => {
    // Create test directory structure matching the real structure
    fs.mkdirSync(path.join(testDir, 'webpack/webpack-lib'), {
      recursive: true
    })
    fs.mkdirSync(path.join(testDir, 'scripts'), {recursive: true})

    // Copy sync script to test directory
    const syncScriptContent = fs.readFileSync(syncScriptPath, 'utf-8')
    fs.writeFileSync(
      path.join(testDir, 'scripts/sync-build-dependencies.mjs'),
      syncScriptContent
    )
  })

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, {recursive: true, force: true})
    }
  })

  it('should validate build-dependencies.json exists and is valid', () => {
    // Setup: Create valid build-dependencies.json
    fs.writeFileSync(
      buildDepsPath,
      JSON.stringify(originalBuildDeps, null, 2) + '\n'
    )

    // Run sync script (now just validates)
    const scriptPath = path.join(testDir, 'scripts/sync-build-dependencies.mjs')
    const stdout = execFileSync('node', [scriptPath], {
      cwd: path.dirname(scriptPath),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).toString()

    // Verify script output indicates success
    expect(stdout).toContain('Validated')
    expect(stdout).toContain('3 dependencies')
  })

  it('should fail if build-dependencies.json is missing', () => {
    // Don't create build-dependencies.json

    const scriptPath = path.join(testDir, 'scripts/sync-build-dependencies.mjs')

    expect(() => {
      execFileSync('node', [scriptPath], {
        cwd: path.dirname(scriptPath),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }).toThrow() // Should exit with error
  })

  it('should fail if build-dependencies.json is invalid JSON', () => {
    // Setup: Create invalid JSON
    fs.writeFileSync(buildDepsPath, '{ invalid json }')

    const scriptPath = path.join(testDir, 'scripts/sync-build-dependencies.mjs')

    expect(() => {
      execFileSync('node', [scriptPath], {
        cwd: path.dirname(scriptPath),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }).toThrow() // Should exit with error
  })

  it('should fail if build-dependencies.json is not an object', () => {
    // Setup: Create array instead of object
    fs.writeFileSync(buildDepsPath, JSON.stringify(['not', 'an', 'object']))

    const scriptPath = path.join(testDir, 'scripts/sync-build-dependencies.mjs')

    expect(() => {
      execFileSync('node', [scriptPath], {
        cwd: path.dirname(scriptPath),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }).toThrow() // Should exit with error
  })

  it('should validate empty object', () => {
    // Setup: Create empty object (valid but empty)
    fs.writeFileSync(buildDepsPath, JSON.stringify({}) + '\n')

    const scriptPath = path.join(testDir, 'scripts/sync-build-dependencies.mjs')
    const stdout = execFileSync('node', [scriptPath], {
      cwd: path.dirname(scriptPath),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).toString()

    // Verify script output indicates success
    expect(stdout).toContain('Validated')
    expect(stdout).toContain('0 dependencies')
  })
})

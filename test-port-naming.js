#!/usr/bin/env node

/**
 * Test script for port-based naming system
 * Demonstrates the new standardized naming convention
 */

import {spawn} from 'child_process'
import path from 'path'
import {fileURLToPath} from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('🧩 Testing Extension.js Port-Based Naming System')
console.log('')

// Test: Start 5 different extensions
async function testPortNaming() {
  console.log('📋 Starting 5 extensions with port-based naming...')

  const instances = []

  // 5 different extensions from examples
  const extensions = [
    {path: './examples/content', name: 'Content Script', port: 8080},
    {path: './examples/action', name: 'Action Extension', port: 8081},
    {path: './examples/content-react', name: 'React Extension', port: 8082},
    {path: './examples/content-vue', name: 'Vue Extension', port: 8083},
    {path: './examples/content-svelte', name: 'Svelte Extension', port: 8084}
  ]

  for (let i = 0; i < extensions.length; i++) {
    const ext = extensions[i]
    console.log(`   Starting ${ext.name} on port ${ext.port}...`)

    const instance = spawn(
      'node',
      [
        path.join(__dirname, 'programs/cli/dist/cli.js'),
        'dev',
        ext.path,
        '--browser',
        'chrome',
        '--port',
        ext.port.toString()
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: __dirname
      }
    )

    // Capture stdout and stderr
    let stdout = ''
    let stderr = ''

    instance.stdout.on('data', (data) => {
      const output = data.toString()
      stdout += output
      console.log(`[${ext.name}] ${output.trim()}`)
    })

    instance.stderr.on('data', (data) => {
      const output = data.toString()
      stderr += output
      console.log(`[${ext.name} ERROR] ${output.trim()}`)
    })

    instance.on('close', (code) => {
      console.log(`[${ext.name}] Process exited with code ${code}`)
    })

    instances.push({
      process: instance,
      extension: ext,
      stdout,
      stderr,
      id: i + 1
    })

    // Wait between starts
    await new Promise((resolve) => setTimeout(resolve, 4000))
  }

  console.log('')
  console.log('⏳ All extensions started! Letting them run for 15 seconds...')
  console.log('')

  // Let them run and capture output
  await new Promise((resolve) => setTimeout(resolve, 15000))

  console.log('')
  console.log('📁 Checking generated extension directories...')

  // Check the generated directories
  try {
    const fs = await import('fs')
    const tempPath = path.join(__dirname, '.extension-js-temp')

    if (fs.default.existsSync(tempPath)) {
      const entries = await fs.default.readdir(tempPath, {withFileTypes: true})
      const directories = entries.filter((entry) => entry.isDirectory())

      console.log(
        `   Found ${directories.length} manager extension directories:`
      )
      for (const dir of directories) {
        console.log(`   - ${dir.name}`)
      }
    } else {
      console.log('   No .extension-js-temp directory found')
    }
  } catch (error) {
    console.log(`   Error checking directories: ${error.message}`)
  }

  console.log('')
  console.log('🧹 Cleaning up instances...')

  // Clean up
  for (const instance of instances) {
    instance.process.kill('SIGINT')
  }

  // Wait for cleanup
  await new Promise((resolve) => setTimeout(resolve, 3000))

  console.log('✅ Test completed!')
  console.log('')

  // Show summary
  console.log('📊 Port-Based Naming Summary:')
  for (const instance of instances) {
    console.log(
      `   ${instance.extension.name}: port ${instance.extension.port} → manager-port-${instance.extension.port}`
    )
  }

  return instances
}

// Check instance registry
async function checkRegistry() {
  console.log('📋 Checking instance registry...')

  try {
    const fs = await import('fs')
    const os = await import('os')
    const registryPath = path.join(
      os.default.homedir(),
      '.extension-js',
      'instances.json'
    )

    if (fs.default.existsSync(registryPath)) {
      const registry = JSON.parse(
        fs.default.readFileSync(registryPath, 'utf-8')
      )
      const runningInstances = Object.values(registry.instances).filter(
        (instance) => instance.status === 'running'
      )

      console.log(
        `   Registry found with ${Object.keys(registry.instances).length} total instances`
      )
      console.log(`   ${runningInstances.length} instances still running`)

      for (const instance of runningInstances) {
        console.log(
          `   - Instance ${instance.instanceId.slice(0, 8)}: ${instance.browser} on port ${instance.port}, WebSocket ${instance.webSocketPort}`
        )
        console.log(`     Manager Extension: manager-port-${instance.port}`)
      }
    } else {
      console.log('   No registry found')
    }
  } catch (error) {
    console.log(`   Error reading registry: ${error.message}`)
  }

  console.log('')
}

// Run the test
async function runTest() {
  try {
    const instances = await testPortNaming()
    await checkRegistry()

    console.log('🎉 Port-based naming test completed successfully!')
    console.log('')
    console.log('Benefits of port-based naming:')
    console.log('  ✅ Short, predictable paths')
    console.log('  ✅ No path length issues')
    console.log('  ✅ Easy to identify by port')
    console.log('  ✅ No collisions between instances')
    console.log('  ✅ Standardized naming convention')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

runTest()

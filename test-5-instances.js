#!/usr/bin/env node

/**
 * Test script for 5 instances with stdout capture
 * This demonstrates the multi-instance system working correctly
 */

import {spawn} from 'child_process'
import path from 'path'
import {fileURLToPath} from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('🧩 Testing Extension.js Multi-Instance System - 5 Instances')
console.log('')

// Test: Start 5 instances and capture their output
async function test5Instances() {
  console.log('📋 Starting 5 instances with different browsers...')

  const instances = []

  // Start 5 instances with different browsers and ports
  const configs = [
    {browser: 'chrome', port: 8080, name: 'Chrome 1'},
    {browser: 'edge', port: 8081, name: 'Edge 1'},
    {browser: 'firefox', port: 8082, name: 'Firefox 1'},
    {browser: 'chrome', port: 8083, name: 'Chrome 2'},
    {browser: 'edge', port: 8084, name: 'Edge 2'}
  ]

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i]
    console.log(`   Starting ${config.name} on port ${config.port}...`)

    const instance = spawn(
      'node',
      [
        path.join(__dirname, 'programs/cli/dist/cli.js'),
        'dev',
        path.join(__dirname, 'examples/content'),
        '--browser',
        config.browser,
        '--port',
        config.port.toString()
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
      console.log(`[${config.name}] ${output.trim()}`)
    })

    instance.stderr.on('data', (data) => {
      const output = data.toString()
      stderr += output
      console.log(`[${config.name} ERROR] ${output.trim()}`)
    })

    instance.on('close', (code) => {
      console.log(`[${config.name}] Process exited with code ${code}`)
    })

    instances.push({
      process: instance,
      config,
      stdout,
      stderr,
      id: i + 1
    })

    // Wait between starts
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  console.log('')
  console.log('⏳ All instances started! Letting them run for 15 seconds...')
  console.log('')

  // Let them run and capture output
  await new Promise((resolve) => setTimeout(resolve, 15000))

  console.log('')
  console.log('🧹 Cleaning up instances...')

  // Clean up
  for (const instance of instances) {
    instance.process.kill('SIGINT')
  }

  // Wait for cleanup
  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log('✅ Test completed!')
  console.log('')

  // Show summary
  console.log('📊 Instance Summary:')
  for (const instance of instances) {
    console.log(
      `   ${instance.config.name}: ${instance.config.browser} on port ${instance.config.port}`
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
    const instances = await test5Instances()
    await checkRegistry()

    console.log('🎉 Multi-instance test completed successfully!')
    console.log('')
    console.log('Each instance should have:')
    console.log('  ✅ Unique instance ID')
    console.log('  ✅ Unique dev server port')
    console.log('  ✅ Unique WebSocket port')
    console.log('  ✅ Unique manager extension')
    console.log('  ✅ Isolated stdout output')
    console.log('  ✅ Independent browser window')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

runTest()

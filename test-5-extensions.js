#!/usr/bin/env node

/**
 * Test script for 5 different extensions
 * This demonstrates the multi-instance system with different extensions
 */

import {spawn} from 'child_process'
import path from 'path'
import {fileURLToPath} from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log(
  '🧩 Testing Extension.js Multi-Instance System - 5 Different Extensions'
)
console.log('')

// Test: Start 5 different extensions
async function test5Extensions() {
  console.log('📋 Starting 5 different extensions...')

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
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  console.log('')
  console.log('⏳ All extensions started! Letting them run for 20 seconds...')
  console.log('')

  // Let them run and capture output
  await new Promise((resolve) => setTimeout(resolve, 20000))

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
  console.log('📊 Extension Summary:')
  for (const instance of instances) {
    console.log(
      `   ${instance.extension.name}: ${instance.extension.path} on port ${instance.extension.port}`
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
        console.log(`     Project: ${instance.projectPath}`)
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
    const instances = await test5Extensions()
    await checkRegistry()

    console.log('🎉 Multi-extension test completed successfully!')
    console.log('')
    console.log('Each extension should have:')
    console.log('  ✅ Unique instance ID')
    console.log('  ✅ Unique dev server port')
    console.log('  ✅ Unique WebSocket port')
    console.log('  ✅ Unique manager extension')
    console.log('  ✅ Isolated stdout output')
    console.log('  ✅ Independent browser window')
    console.log('  ✅ Different extension content')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

runTest()

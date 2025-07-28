#!/usr/bin/env node

/**
 * Demonstration script for 5 different extensions
 * Shows real-time output from each instance
 */

import {spawn} from 'child_process'
import path from 'path'
import {fileURLToPath} from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('🧩 Extension.js Multi-Instance Demo - 5 Different Extensions')
console.log('')

// Start 5 different extensions
async function startExtensions() {
  console.log('📋 Starting 5 different extensions...')
  console.log('')

  const extensions = [
    {
      path: './examples/content',
      name: 'Content Script',
      port: 8080,
      color: '🔵'
    },
    {
      path: './examples/action',
      name: 'Action Extension',
      port: 8081,
      color: '🟢'
    },
    {
      path: './examples/content-react',
      name: 'React Extension',
      port: 8082,
      color: '🔴'
    },
    {
      path: './examples/content-vue',
      name: 'Vue Extension',
      port: 8083,
      color: '🟡'
    },
    {
      path: './examples/content-svelte',
      name: 'Svelte Extension',
      port: 8084,
      color: '🟣'
    }
  ]

  const instances = []

  for (let i = 0; i < extensions.length; i++) {
    const ext = extensions[i]
    console.log(`${ext.color} Starting ${ext.name} on port ${ext.port}...`)

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

    // Capture and display output with color coding
    instance.stdout.on('data', (data) => {
      const output = data.toString()
      const lines = output.split('\n').filter((line) => line.trim())
      lines.forEach((line) => {
        console.log(`${ext.color} [${ext.name}] ${line}`)
      })
    })

    instance.stderr.on('data', (data) => {
      const output = data.toString()
      const lines = output.split('\n').filter((line) => line.trim())
      lines.forEach((line) => {
        console.log(`${ext.color} [${ext.name} ERROR] ${line}`)
      })
    })

    instance.on('close', (code) => {
      console.log(`${ext.color} [${ext.name}] Process exited with code ${code}`)
    })

    instances.push({
      process: instance,
      extension: ext
    })

    // Wait between starts
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  console.log('')
  console.log('🎉 All 5 extensions are now running!')
  console.log('')
  console.log('📊 Summary:')
  console.log('  🔵 Content Script: Basic content script extension')
  console.log('  🟢 Action Extension: Popup action extension')
  console.log('  🔴 React Extension: React-based content script')
  console.log('  🟡 Vue Extension: Vue-based content script')
  console.log('  🟣 Svelte Extension: Svelte-based content script')
  console.log('')
  console.log('Each extension should have:')
  console.log('  ✅ Unique instance ID')
  console.log('  ✅ Unique dev server port (8080-8084)')
  console.log('  ✅ Unique WebSocket port (9000-9004)')
  console.log('  ✅ Unique manager extension')
  console.log('  ✅ Independent browser window')
  console.log('  ✅ Different extension content')
  console.log('')
  console.log('Press Ctrl+C to stop all instances...')
  console.log('')

  // Keep running until interrupted
  process.on('SIGINT', async () => {
    console.log('')
    console.log('🧹 Stopping all instances...')

    for (const instance of instances) {
      instance.process.kill('SIGINT')
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
    console.log('✅ All instances stopped.')
    process.exit(0)
  })

  return instances
}

// Run the demo
startExtensions().catch((error) => {
  console.error('❌ Demo failed:', error)
  process.exit(1)
})

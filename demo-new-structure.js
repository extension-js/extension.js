#!/usr/bin/env node

/**
 * Demo New Structure - Flatter Directory Organization
 * Shows the improved structure with {browser}-manager-{port} naming
 */

import {readFile} from 'fs/promises'
import path from 'path'
import {fileURLToPath} from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('🎉 Extension.js - New Flatter Structure Demo')
console.log('')

async function showNewStructure() {
  console.log('📊 New Structure: {browser}-manager-{port} Naming Convention')
  console.log('')

  try {
    // Check the content example's dist structure
    const contentDistPath = path.join(__dirname, 'examples/content/dist/extension-js/extensions')
    
    if (fs.existsSync(contentDistPath)) {
      const entries = await fs.promises.readdir(contentDistPath, {withFileTypes: true})
      const directories = entries.filter(entry => entry.isDirectory())

      console.log('📁 Content Extension Dist Structure:')
      console.log(`   📂 ${contentDistPath}`)
      console.log('')
      
      // Separate base templates from instances
      const baseTemplates = directories.filter(dir => 
        ['chrome-manager', 'edge-manager', 'firefox-manager'].includes(dir.name)
      )
      const instances = directories.filter(dir => 
        dir.name.includes('-manager-') && !['chrome-manager', 'edge-manager', 'firefox-manager'].includes(dir.name)
      )

      console.log('🔧 Base Manager Templates:')
      for (const dir of baseTemplates) {
        console.log(`   📁 ${dir.name}/`)
      }
      console.log('')

      console.log('🚀 Instance-Specific Managers:')
      for (const dir of instances) {
        console.log(`   📁 ${dir.name}/`)
        
        // Parse browser and port from name
        const match = dir.name.match(/^(\w+)-manager-(\d+)$/)
        if (match) {
          const [, browser, port] = match
          console.log(`      🌐 Browser: ${browser}`)
          console.log(`      🔌 Port: ${port}`)
          
          // Check if instance is running
          const instancePath = path.join(contentDistPath, dir.name)
          const manifestPath = path.join(instancePath, 'manifest.json')
          
          try {
            const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8')
            const manifest = JSON.parse(manifestContent)
            console.log(`      📄 Name: ${manifest.name}`)
            console.log(`      📄 Description: ${manifest.description}`)
          } catch (error) {
            console.log(`      ❌ Error reading manifest: ${error.message}`)
          }
        }
        console.log('')
      }
    }

    // Show the new structure benefits
    console.log('🎯 Benefits of New Structure:')
    console.log('')
    console.log('✅ Flatter Organization:')
    console.log('   📁 extensions/chrome-manager-8096/')
    console.log('   📁 extensions/edge-manager-8097/')
    console.log('   📁 extensions/firefox-manager-8098/')
    console.log('')
    console.log('✅ Predictable Naming:')
    console.log('   • {browser}-manager-{port} pattern')
    console.log('   • Easy to identify browser and port')
    console.log('   • No nested directories')
    console.log('')
    console.log('✅ Better Debugging:')
    console.log('   • Direct path identification')
    console.log('   • Clear instance ownership')
    console.log('   • Easy to find specific instances')
    console.log('')
    console.log('✅ Simplified Cleanup:')
    console.log('   • Can delete specific instances easily')
    console.log('   • No complex path traversal')
    console.log('   • Clear separation from base templates')
    console.log('')

    // Compare old vs new
    console.log('🔄 Migration: Old vs New Structure')
    console.log('')
    console.log('🔴 OLD STRUCTURE:')
    console.log('   📁 extensions/manager-port-8094/')
    console.log('   📁 extensions/manager-port-8095/')
    console.log('   ❌ No browser identification in name')
    console.log('   ❌ Harder to debug browser-specific issues')
    console.log('')
    console.log('🟢 NEW STRUCTURE:')
    console.log('   📁 extensions/chrome-manager-8096/')
    console.log('   📁 extensions/edge-manager-8097/')
    console.log('   ✅ Browser clearly identified')
    console.log('   ✅ Port clearly identified')
    console.log('   ✅ Better for debugging and management')
    console.log('')

    console.log('🚀 Implementation Complete!')
    console.log('')
    console.log('The multi-instance system now uses a flatter, more intuitive')
    console.log('directory structure with {browser}-manager-{port} naming.')
    console.log('This makes debugging, management, and cleanup much easier!')

  } catch (error) {
    console.error('❌ Error reading structure:', error.message)
  }
}

showNewStructure() 
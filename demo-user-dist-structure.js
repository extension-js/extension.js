#!/usr/bin/env node

/**
 * Demo User Dist Structure - Manager Extensions in User Project
 * Shows the new structure where manager extensions are stored in user's dist/extension-js/
 */

import {readFile} from 'fs/promises'
import path from 'path'
import {fileURLToPath} from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('🎉 Extension.js - User Dist Structure Demo')
console.log('')

async function showUserDistStructure() {
  console.log('📊 New Structure: Manager Extensions in User Dist Folder')
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
      
      for (const dir of directories) {
        console.log(`   ✅ ${dir.name}`)
        
                         // Show details for manager extensions
                 if (dir.name.includes('-manager-')) {
          const managerPath = path.join(contentDistPath, dir.name)
          const manifestPath = path.join(managerPath, 'manifest.json')
          
          try {
            const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8')
            const manifest = JSON.parse(manifestContent)
            
            console.log(`      📄 Name: ${manifest.name}`)
            console.log(`      📄 Description: ${manifest.description}`)
            console.log(`      📄 Version: ${manifest.version}`)
            
            // Check reload-service.js for port info
            const reloadServicePath = path.join(managerPath, 'reload-service.js')
            const reloadContent = await fs.promises.readFile(reloadServicePath, 'utf-8')
            
            const portMatch = reloadContent.match(/const\s+port\s*=\s*['"](\d+)['"]/)
            const instanceMatch = reloadContent.match(/const\s+instanceId\s*=\s*['"]([^'"]+)['"]/)
            
            if (portMatch) {
              console.log(`      🔌 WebSocket Port: ${portMatch[1]}`)
            }
            if (instanceMatch) {
              console.log(`      🆔 Instance ID: ${instanceMatch[1].slice(0, 8)}`)
            }
            
          } catch (error) {
            console.log(`      ❌ Error reading manifest: ${error.message}`)
          }
        }
        console.log('')
      }
    }

    // Check other examples
    const examples = ['action', 'content-react', 'new-less', 'new-sass', 'new-react']
    
    console.log('📁 Other Examples Dist Structure:')
    for (const example of examples) {
      const exampleDistPath = path.join(__dirname, `examples/${example}/dist/extension-js/extensions`)
      
      if (fs.existsSync(exampleDistPath)) {
        const entries = await fs.promises.readdir(exampleDistPath, {withFileTypes: true})
        const managerDirs = entries.filter(entry => 
          entry.isDirectory() && entry.name.startsWith('manager-port-')
        )
        
        if (managerDirs.length > 0) {
          console.log(`   🔵 ${example}: ${managerDirs.length} manager extension(s)`)
          for (const dir of managerDirs) {
            console.log(`      ✅ ${dir.name}`)
          }
        }
      }
    }
    console.log('')

    // Compare with old global structure
    const globalTempPath = path.join(__dirname, '.extension-js-temp')
    
    console.log('📊 Comparison: Old vs New Structure')
    console.log('')
    console.log('🔴 OLD STRUCTURE (Global):')
    console.log(`   📂 ${globalTempPath}`)
    console.log('   ❌ All instances shared same global temp folder')
    console.log('   ❌ Hard to track which extension belongs to which project')
    console.log('   ❌ Potential conflicts between different projects')
    console.log('')
    console.log('🟢 NEW STRUCTURE (User Dist):')
    console.log('   📂 examples/content/dist/extension-js/extensions/')
    console.log('   📂 examples/action/dist/extension-js/extensions/')
    console.log('   📂 examples/new-less/dist/extension-js/extensions/')
    console.log('   ✅ Each project has its own manager extensions')
    console.log('   ✅ Clear separation between different projects')
    console.log('   ✅ Manager extensions live with the project')
    console.log('   ✅ Easier to track and debug')
    console.log('   ✅ No conflicts between different projects')
    console.log('')

    console.log('🎯 Benefits of New Structure:')
    console.log('   ✅ Project-specific manager extensions')
    console.log('   ✅ Better organization and clarity')
    console.log('   ✅ Easier debugging and troubleshooting')
    console.log('   ✅ No global state conflicts')
    console.log('   ✅ Each project is self-contained')
    console.log('   ✅ Manager extensions are part of the project build')
    console.log('   ✅ Better for version control and deployment')
    console.log('')

    console.log('🚀 Implementation Complete!')
    console.log('')
    console.log('The multi-instance system now stores manager extensions')
    console.log('in each project\'s dist/extension-js/extensions/ folder.')
    console.log('This provides better organization and project isolation.')

  } catch (error) {
    console.error('❌ Error reading structure:', error.message)
  }
}

showUserDistStructure() 
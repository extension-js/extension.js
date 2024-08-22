// @ts-ignore
import {exec} from 'child_process'
// @ts-ignore
import path from 'path'
import {ALL_TEMPLATES} from './examples/data'

// Function to run yarn in a specified directory
function installDeps(directory: string) {
  return new Promise((resolve, reject) => {
    console.log(`Installing template dependencies for ${directory}`)
    exec('yarn', {cwd: directory}, (error: any, stdout: any, stderr: any) => {
      if (error) {
        console.error(`Error running yarn in ${directory}: ${error.message}`)
        reject(error)
        return
      }
      console.log(`Yarn completed in ${directory}`)
      resolve(stdout ? stdout : stderr)
    })
  })
}

// Iterate over ALL_TEMPLATES and run yarn in each corresponding folder
async function installDepsInAllTemplates() {
  for (const template of ALL_TEMPLATES) {
    // @ts-ignore
    const directory = path.resolve(__dirname, 'examples', template.name)
    try {
      await installDeps(directory)
    } catch (error: any) {
      console.error(`Failed to run yarn in ${directory}: ${error.message}`)
    }
  }

  console.log('Dependency installation completed in all template folders.')
}

// Execute the function
installDepsInAllTemplates()

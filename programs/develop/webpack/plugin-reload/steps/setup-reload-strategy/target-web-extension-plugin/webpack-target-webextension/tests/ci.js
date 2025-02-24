const { execSync } = require('child_process')
const { join } = require('path')

const cwd = join(__dirname, '../')

if (execSync('git diff --staged', { cwd }).length) {
  execSync('git diff --staged', { cwd, stdio: 'inherit' })
  setTimeout(() => {
    console.error('No files should be changed after CI test. Please update snapshot locally.')
    process.exit(1)
  }, 1000)
}

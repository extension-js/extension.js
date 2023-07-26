const fs = require('fs')
const path = require('path')
const rm = require('rimraf')

fs.readdir(path.join(__dirname, '..', 'fixtures'), (err, files) => {
  if (err) throw err

  files.forEach((file) => {
    const filePath = path.resolve('fixtures', file, 'dist')

    if (!fs.existsSync(filePath)) return

    console.log(`Cleaning up ${filePath} before tests start`)

    rm.sync(filePath)
  })
})

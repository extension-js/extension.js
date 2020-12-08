// List of words you can't use as a name for your project
// because they conflict with either current or future program commands
const reservedKeywords = [
  'build',
  'eject',
  'start',
  'test',
  'open',
  'deploy'
]

module.exports = function () {
  const commands = process.argv

  return reservedKeywords
    .some((word, index) => word === commands[index])
}

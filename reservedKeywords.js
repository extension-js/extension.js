// List of words you can't use as a name for your project
// because they conflict with either current or future program commands

const reservedKeywordSet = new Set(['build', 'eject', 'start', 'test', 'open', 'deploy', 'templates', 'template', 'standard']);

function isKeyword() {
  const commands = process.argv;
  
  return commands.some((command) => reservedKeywordSet.has(command));
}

module.exports = isKeyword;

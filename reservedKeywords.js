// List of words you can't use as a name for your project
// because they conflict with either current or future program commands
const reservedKeywords = new Set(['build', 'eject', 'start', 'test', 'open', 'deploy', 'templates', 'template', 'standard']);

module.exports = function reservedKeywords() {
	const commands = process.argv;

	return commands.some((command) => reservedKeywords.has(command));
};

if (reservedKeywords) {
	console.log('Reserved keywords are being used.');
}
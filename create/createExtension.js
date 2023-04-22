//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const createDirectory = require('./steps/createDirectory');
const importExternalTemplate = require('./steps/importExternalTemplate');
const importLocalTemplate = require('./steps/importLocalTemplate');
const writePackageJson = require('./steps/writePackageJson');
const installDependencies = require('./steps/installDependencies');
const messages = require('./messages');
const abortAndClean = require('./steps/abortProjectAndClean');
const cleanTemplateFolder = require('./steps/cleanTemplateFolder');

module.exports = async function createExtension(workingDir, projectName, template) {
	const isExternalTemplate = !!template;

	try {
		await createDirectory(workingDir, projectName);

		isExternalTemplate ? await importExternalTemplate(workingDir, projectName, template) : await importLocalTemplate(workingDir, projectName);

		await writePackageJson(workingDir, projectName, template);
		await installDependencies(workingDir, projectName);
		await cleanTemplateFolder(template, isExternalTemplate);
		messages.successfullInstall(workingDir, projectName);
	} catch (error) {
		await abortAndClean(error, workingDir, projectName);
		await cleanTemplateFolder(template, isExternalTemplate);
	}
};

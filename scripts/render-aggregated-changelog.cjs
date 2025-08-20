#!/usr/bin/env node
/*
 Outputs the latest aggregated changelog entry across programs/* to stdout.
*/

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const programsDir = path.join(repoRoot, 'programs');

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fileExists(filePath) {
	try {
		fs.accessSync(filePath, fs.constants.F_OK);
		return true;
	} catch (_) {
		return false;
	}
}

function getProgramPackageDirs() {
	if (!fileExists(programsDir)) return [];
	const entries = fs.readdirSync(programsDir, { withFileTypes: true });
	return entries
		.filter(e => e.isDirectory())
		.map(e => path.join('programs', e.name))
		.filter(dir => fileExists(path.join(repoRoot, dir, 'package.json')) && fileExists(path.join(repoRoot, dir, 'CHANGELOG.md')));
}

function extractLatestChangelogSection(changelogContent) {
	const lines = changelogContent.split(/\r?\n/);
	let startIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith('## ')) {
			startIndex = i;
			break;
		}
	}
	if (startIndex === -1) return null;

	let endIndex = lines.length;
	for (let i = startIndex + 1; i < lines.length; i++) {
		if (lines[i].startsWith('## ')) {
			endIndex = i;
			break;
		}
	}
	const section = lines.slice(startIndex, endIndex).join('\n');
	const versionMatch = lines[startIndex].match(/^##\s+([^\s]+).*$/);
	const version = versionMatch ? versionMatch[1] : '0.0.0';
	return { version, section };
}

function formatDateISO(date = new Date()) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function buildAggregatedEntry(entries) {
	const date = formatDateISO();
	const summaryLines = entries.map(e => `- ${e.name} v${e.version}`);
	const details = entries.map(e => `### ${e.name} v${e.version}\n\n${e.section}`).join('\n\n');
	return `## ${date}\n\n${summaryLines.join('\n')}\n\n#### Details\n\n${details}\n`;
}

(function main() {
	const entries = [];

	for (const dir of getProgramPackageDirs()) {
		const absDir = path.join(repoRoot, dir);
		const pkgJsonPath = path.join(absDir, 'package.json');
		const changelogPath = path.join(absDir, 'CHANGELOG.md');
		if (!fileExists(pkgJsonPath) || !fileExists(changelogPath)) continue;

		const pkg = readJson(pkgJsonPath);
		const changelog = fs.readFileSync(changelogPath, 'utf8');
		const latest = extractLatestChangelogSection(changelog);
		if (!latest) continue;

		entries.push({ name: pkg.name, version: latest.version.replace(/^v/, ''), section: latest.section });
	}

	if (entries.length === 0) {
		process.exit(0);
	}

	const aggregatedEntry = buildAggregatedEntry(entries);
	process.stdout.write(aggregatedEntry);
})();



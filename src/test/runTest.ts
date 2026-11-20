import * as path from 'path';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

async function main() {
	try {
		const vscodePath = await downloadAndUnzipVSCode();
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		await runTests({
			vscodeExecutablePath: vscodePath,
			extensionDevelopmentPath,
			extensionTestsPath,
		});
	} catch (err) {
		console.error('Failed to run tests', err);
		process.exit(1);
	}
}

main();

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { userDir, outputDir, inputFile, outputName } = require('./constants');

const outputFile = path.join(outputDir, outputName);
const finalPkg = path.join(outputDir, 'package.json');
const projectName = path.dirname(__filename).split(path.sep).pop();

const nrPackageFile = path.join(
	__dirname,
	'node_modules/node-red/package.json'
);
const requestSourceFile = path.join(
	__dirname,
	'node_modules/@node-red/nodes/core/network/21-httprequest.js'
);

const nativeNodeModulesPlugin = {
	name: 'native-node-modules',
	setup(build) {
		build.onResolve({ filter: /\.node$/, namespace: 'file' }, (args) => ({
			path: require.resolve(args.path, { paths: [args.resolveDir] }),
			namespace: 'node-file'
		}));

		build.onLoad({ filter: /.*/, namespace: 'node-file' }, (args) => ({
			contents: `
                import path from ${JSON.stringify(args.path)}
                try { module.exports = require(path) }
                catch {}
            `
		}));

		build.onResolve({ filter: /\.node$/, namespace: 'node-file' }, (args) => ({
			path: args.path,
			namespace: 'file'
		}));

		const opts = build.initialOptions;
		opts.loader = opts.loader || {};
		opts.loader['.node'] = 'file';
		opts.loader['.sh'] = 'binary';
	}
};

/* Things to not include during bundling */
const externals = [
	'@node-red/nodes',
	'@node-red/editor-client',
	'@node-rs',
	'oauth2orize',
	'got',
	'./resources'
];

// File exists
const fileExists = (path) => {
	return fs.existsSync(path);
};

/* Utility Functions */
const patchFile = (filePath, replacements) => {
	let content = fs.readFileSync(filePath, 'utf-8');
	replacements.forEach(([searchValue, replaceValue]) => {
		content = content.replace(searchValue, replaceValue);
	});
	fs.writeFileSync(filePath, content);
};

const copyExternalDependencies = (externals, outputDir) => {
	externals.map(async (ext) => {
		const extPath = ext.startsWith('./') ? ext : path.join('node_modules', ext);
		if (fileExists(extPath)) {
			fs.cpSync(extPath, path.join(outputDir, extPath), { recursive: true });
		}
	});
};

const esBuildPackage = async (file) => {
	const config = {
		entryPoints: [file],
		bundle: true,
		platform: 'node',
		target: 'node20',
		allowOverwrite: true,
		keepNames: true,
		outfile: file
	};

	await esbuild.build(config);

	const pathSplit = file.split('/');
	const packageFile = `${pathSplit[0]}/${pathSplit[1]}/package.json`;
	const packageJson = require(path.join(__dirname, packageFile));
	packageJson.type = 'commonjs';
	await fs.writeFileSync(packageFile, JSON.stringify(packageJson, null, 2));
};

/* Main */
const run = async () => {
	// Build to CJS
	await esBuildPackage('node_modules/got/dist/source/index.js');
	await esBuildPackage('node_modules/form-data-encoder/lib/index.js');
	await esBuildPackage('node_modules/lowercase-keys/index.js');
	await esBuildPackage('node_modules/p-cancelable/index.js');
	await esBuildPackage('node_modules/responselike/index.js');
	await esBuildPackage('node_modules/normalize-url/index.js');
	await esBuildPackage('node_modules/mimic-response/index.js');

	// Bundle main source file
	const config = {
		entryPoints: [inputFile],
		plugins: [nativeNodeModulesPlugin],
		keepNames: true,
		bundle: true,
		platform: 'node',
		target: 'node20',
		outfile: outputFile,
		external: externals
	};

	await esbuild.build(config);

	// Patch the output file with Node-RED version and embedded flow modifications
	const nrVersion = require(nrPackageFile).version;
	const replacements = [
		['var version;', `var version = "${nrVersion}";`],
		['{SFE_PROJECT_DIR}', projectName]
	];

	await patchFile(outputFile, replacements);

	// Patch request source file to use require instead of import for 'got'
	await patchFile(requestSourceFile, [
		["const { got } = await import('got')", "const { got } = require('got')"]
	]);

	// Copy external dependencies to the output directory
	copyExternalDependencies(externals, outputDir);

	// Create final package.json
	const pkg = {
		name: 'node-red-sfe',
		bin: outputName,
		pkg: {
			assets: [
				'./node_modules/**',
				'./resources/**',
				`${userDir}.dat`,
				'./flows.json'
			]
		}
	};

	const sessionsPath = path.join(userDir, '.sessions.json');
	if (fileExists(sessionsPath)) {
		fs.unlinkSync(sessionsPath);
	}

	const output = fs.createWriteStream(`${userDir}.dat`);
	output.on('close', function () {
		fs.copyFileSync(`${userDir}.dat`, path.join(outputDir, `${userDir}.dat`));
		fs.copyFileSync('./flows.json', path.join(outputDir, 'flows.json'));
	});

	const Archiver = archiver('zip');

	Archiver.pipe(output);
	Archiver.directory(userDir, false);
	Archiver.finalize();

	fs.writeFileSync(finalPkg, JSON.stringify(pkg, null, 2));
};

run().catch((err) => {
	console.error(err);
	process.exit(1);
});

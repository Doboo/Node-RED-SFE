const http = require('http');
const express = require('express');
const RED = require('node-red');
const fs = require('fs');
const { join, dirname } = require('path');
const nrRuntimeSettings = require('./settings');
const open = require('open');
const AdmZip = require('adm-zip');
const { userDir, ns } = require('./constants');

/* ------  Don't mess with anything below - unless you're a nerd ;-) ------ */

console.clear();

console.log('Welcome to Node-RED-SFE');
console.log('===================');
console.log('');

const log = (level, log) => {
	console.log(`${new Date().toISOString()} [${level}] ${log}`);
};

// OS Volume Prefix
const pathPrefix = process.platform === 'win32' ? 'c:/' : '/';

log('info', `Platform: ${process.platform}`);
log('info', `Node Version: ${process.version}`);

// Important paths
const embeddedUserDirSnapshot = `${pathPrefix}snapshot/${ns}/build/${userDir}.dat`;
const embeddedUserFlowFile = `${pathPrefix}snapshot/${ns}/build/flows.json`;

// In develop mode?
const developMode = process.argv[2] === '--develop';

// Get Flow File
const getUserDirPath = () => {
	if (developMode) {
		return join(__dirname, userDir);
	}
	return join(dirname(process.execPath), userDir);
};

// Get Flow File
const getFlowFile = () => {
	if (developMode) {
		return join(__dirname, 'flows.json');
	}

	return embeddedUserFlowFile;
};

// Main
const run = async () => {
	const app = express();
	const server = http.createServer(app);

	delete nrRuntimeSettings.userDir;
	delete nrRuntimeSettings.logging;
	delete nrRuntimeSettings.editorTheme;
	delete nrRuntimeSettings.flowFile;
	delete nrRuntimeSettings.readOnly;

	const nrSettings = {
		userDir: getUserDirPath(),
		flowFile: getFlowFile(),
		logging: {
			console: {
				level: 'off',
				metrics: false,
				audit: false
			}
		},
		editorTheme: {
			header: {
				title: `Node-RED SFE ${developMode ? '[Design Time]' : '[Run Time]'}`
			},
			page: {
				title: `Node-RED SFE ${developMode ? '[Design Time]' : '[Run Time]'}`
			},
			projects: {
				enabled: false
			},
			tours: false
		},
		...nrRuntimeSettings
	};

	if (developMode) {
		nrSettings.disableEditor = false;
	}

	if (!developMode) {
		if (!fs.existsSync(getUserDirPath())) {
			const zip = new AdmZip(embeddedUserDirSnapshot);
			zip.extractAllTo(getUserDirPath(), true);
		}

		nrSettings.editorTheme.header.image = `${pathPrefix}snapshot/${ns}/build/resources/node-red.png`;
		nrSettings.editorTheme.page.css = `${pathPrefix}snapshot/${ns}/build/resources/sfe.css`;
		nrSettings.readOnly = true;
		nrSettings.editorTheme.login = {
			image: `${pathPrefix}snapshot/${ns}/build/resources/node-red-256-embedded.png`
		};
	} else {
		nrSettings.editorTheme.login = {
			image: join(__dirname, 'resources', 'node-red-256-external.png')
		};
	}

	// Initialize Node-RED with the given settings
	RED.init(server, nrSettings);
	app.use(nrSettings.httpAdminRoot, RED.httpAdmin);
	app.use(nrSettings.httpNodeRoot, RED.httpNode);

	log('info', `Node-RED Version: ${RED.version()}`);
	log('info', `Run Mode: ${developMode ? 'Develop' : 'Production'}`);

	const baseURL = `http://127.0.0.1:${nrSettings.uiPort}${nrSettings.httpAdminRoot}`;
	const getAutoLoad = () => {
		const ALFile = join(dirname(process.argv0), 'AUTOLOAD');
		if (fs.existsSync(ALFile)) {
			const URL = fs.readFileSync(ALFile, 'utf8');
			if (URL.startsWith('/')) {
				return `${baseURL}${URL.replace('/', '')}`;
			} else {
				return URL;
			}
		} else {
			return undefined;
		}
	};

	// Start the HTTP server
	server.on('listening', (e) => {
		RED.start()
			.catch((err) => {
				log('error', err.message);
			})
			.then(() => {
				const AL = getAutoLoad();
				if (AL) {
					log('info', `Opening AL: ${AL}`);
					open(AL);
				} else {
					if (developMode) {
						log('info', `Opening AL: ${baseURL}`);
						open(baseURL);
					}
				}
				log('info', 'Starting...DONE');
			});
	});
	log('info', 'Starting...');
	server.listen(nrSettings.uiPort);
};

// Run the main function and handle any errors
run().catch((err) => {
	log('error', err.message);
	process.exit(1);
});

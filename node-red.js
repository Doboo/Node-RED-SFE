const http = require('http');
const express = require('express');
const RED = require('node-red');
const fs = require('fs');
const { join, dirname } = require('path');
const nrRuntimeSettings = require('./settings');
const open = require('open');
const AdmZip = require('adm-zip');
const { userDir, noLoadUserDir, ns } = require('./constants');
const dayjs = require('dayjs');
const localizedFormat = require('dayjs/plugin/localizedFormat');
const localeData = require('dayjs/plugin/localeData');
dayjs.extend(localizedFormat);
dayjs.extend(localeData);

/* ------  Don't mess with anything below - unless you're a nerd ;-) ------ */

console.clear();

console.log('Welcome to Node-RED-SFE');
console.log('===================');
console.log('');

const log = (level, subject, message) => {
	level = `[${level}]`;
	const paddedSubject = subject.padEnd(17, ' ');
	const paddedLevel = level.padEnd(7, ' ').toUpperCase();
	console.log(
		`${dayjs().format('L LTS')} ${paddedLevel} ${paddedSubject} : ${message}`
	);
};

// OS Volume Prefix
const pathPrefix = process.platform === 'win32' ? 'c:/' : '/';

log('info', 'Platform', process.platform);
log('info', 'Node Version', process.version);

// Important paths
const embeddedUserDirSnapshot = `${pathPrefix}snapshot/${ns}/build/${userDir}.dat`;
const embeddedUserFlowFile = `${pathPrefix}snapshot/${ns}/build/flows.json`;

// In develop mode?
const developMode = process.argv[2] === '--develop';
const noLoad = developMode === false && process.argv[2] === '--noload';

// Get User Dir
const getUserDirPath = () => {
	if (developMode) {
		return join(__dirname, userDir);
	}
	if (noLoad) {
		return join(dirname(process.execPath), noLoadUserDir);
	}
	return join(dirname(process.execPath), userDir);
};

// Get Flow File
const getFlowFile = () => {
	if (developMode) {
		return join(__dirname, 'flows.json');
	}
	if (noLoad) {
		return join(getUserDirPath(), 'flows.json');
	}

	return embeddedUserFlowFile;
};

const getRunModeText = (usenumber) => {
	if (developMode) {
		return usenumber ? 1 : 'Design Time';
	}

	if (!developMode && !noLoad) {
		return usenumber ? 2 : 'Production (Locked)';
	}

	if (!developMode && noLoad) {
		return usenumber ? 3 : 'Production (Free Roam)';
	}
};

process.env['SFE'] = getRunModeText(true);

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
				title: `Node-RED SFE [${getRunModeText()}]`
			},
			page: {
				title: `Node-RED SFE [${getRunModeText()}]`
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

	if (!developMode && !noLoad) {
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

	nrSettings.functionGlobalContext = nrSettings.functionGlobalContext || {};
	nrSettings.functionGlobalContext.SFE = {
		log: {
			INFO: (topic, message) => {
				log('info', topic, message);
			},
			WARN: (topic, message) => {
				log('warn', topic, message);
			},
			ERROR: (topic, message) => {
				log('error', topic, message);
			},
			DEBUG: (topic, message) => {
				log('debug', topic, message);
			}
		}
	};

	// Initialize Node-RED with the given settings
	RED.init(server, nrSettings);
	app.use(nrSettings.httpAdminRoot, RED.httpAdmin);
	app.use(nrSettings.httpNodeRoot, RED.httpNode);

	if (!developMode && !noLoad) {
		if (!fs.existsSync(getUserDirPath())) {
			log('info', 'userDir', 'Unpacking userDir...');
			const zip = new AdmZip(embeddedUserDirSnapshot);
			zip.extractAllTo(getUserDirPath(), true);
			log('info', 'userDir', 'Unpacking userDir...Done');
		}
	}

	log('info', 'Node-RED Version', RED.version());
	log('info', 'Run Mode', getRunModeText());
	log('info', 'User Directory', getUserDirPath());
	log('info', 'Flow File', getFlowFile());

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
				log('error', 'on listening', err.message);
			})
			.then(() => {
				const AL = getAutoLoad();
				if (AL) {
					log('info', 'Autoload', AL);
					open(AL);
				} else {
					if (developMode) {
						log('info', 'Autoload', baseURL);
						open(baseURL);
					}
				}
				log('info', 'Startup', 'Done');
			});
	});
	server.listen(nrSettings.uiPort);
};

// Run the main function and handle any errors
run().catch((err) => {
	log('error', 'on run', err.message);
	process.exit(1);
});

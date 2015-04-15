var net = require('net');
var os = require('os');
var fs = require('fs');
var tls = require('tls');
var util = require('util');
var path = require('path');
var topsort = require('topsort');
var extend = require('extend');
var nodemailer = require('nodemailer');
var uuid = require('node-uuid');
var _ = require('lodash');
var SMTPSession = require('./smtp-session');
var SMTPClient = require('./smtp-client');

var mailer = {

	createServer: function(config, cb/*session*/) {

		// the configuration, merged with the config supplied in the constructor
		var config = extend(true, {
			// should the server run with TLS encryption (SMTPS) from the beginning?
			// if the server is not secure, clients can still use STARTTLS
			secure: false,
			// the port to listen on
			port: 25,
			// the hostname of the server
			hostname: os.hostname(),
			// the greeting message
			greeting: 'mail-io',
			// a list of additional command handlers
			// handlers is a map with 'event' as the key and an array of handler definition objects as the value
			// handler definition objects have to look like this:
			// { name: 'myhandler', requires: ['some/dependency'], handler: function(req, res) {...} }
			handlers: {},
			// a list of domains served by this host
			// - defaults to the domain name parsed from the hostname, or the hostname if no domain part was found)
			domains: [os.hostname().split('.').length > 1 ? os.hostname().split('.').slice(1).join('.') : os.hostname()],
			// relay settings
			relay: {
				hostname: os.hostname(),
				queueDir: path.join(os.tmpDir(), 'mail-io-queue'),
				retryHours: 48,
				retryBaseInterval: 60,
				concurrentTransactions: 5
			},
			// plugin configuration
			plugins: {
				'ehlo/core': {
					// a list of supported SMTP extensions
					features: ['STARTTLS', 'AUTH LOGIN PLAIN', '8BITMIME', 'PIPELINING', 'SIZE']
				},
				'rcpt/dnsbl': {
					// the blacklist service to use for DNSBL filtering
					blacklist: 'zen.spamhaus.org'
				},
				'queue/spamd': {
					// messages that score higher than the baseScore will be treated as spam
					baseScore: 5
				},
				'queue/relay': {
					// should we relay messages?
					enabled: true,
					// allow relay to foreign domains if the sender is not authenticated?
					unauthenicated: false,
					// do we relay mail from senders that do not belong to our served domains (config.domains)?
					open: false
				},
				'queue/maildir': {
					// maildir storage location. %n will be replaced with the username and %d with the domain name
					mailDir: path.join(os.tmpDir(), 'mail-io-maildir', '%d', '%n')
				}
			},
			limits: {
				// the maximum time in ms a connection can idle before getting disconnected
				idleTimeout: 60 * 1000,
				// the maximum size of a message
				messageSize: 100 * 1024 * 1024,
				// the maximum number of authentication failures before the client is disconnected
				authFailures: 5,
				// the maximum number of unrecognized commands before the client is disconnected
				unrecognizedCommands: 5,
				// the maximum amount of concurrent client connections
				maxConnections: 100,
				// the maximum number of recipients allowed
				maxRecipients: 100
			},
			// the logger to use
			logger: {
				debug: console.log,
				verbose: console.log,
				info: console.log,
				warn: console.log,
				error: console.log
			},
			tls: {
				key: fs.readFileSync(__dirname + '/../keys/key.pem'),
				cert: fs.readFileSync(__dirname + '/../keys/cert.pem'),
				ca: fs.readFileSync(__dirname + '/../keys/ca.pem'),
				ciphers: 'ECDH+AESGCM:DH+AESGCM:ECDH+AES256:DH+AES256:ECDH+AES128:DH+AES:ECDH+3DES:DH+3DES:RSA+AESGCM:RSA+AES:RSA+3DES:!aNULL:!MD5:!DSS',
				honorCipherOrder: true
			}
		}, config);

		// initialize a relay instance for every server type
		var relayConfig = _.cloneDeep(_.extend({logger: config.logger}, config.relay));
		var relay = null;

		// create the server
		var server = (config.secure ? tls : net).createServer(config.secure ? config.tls : {}, function(socket) {

			// initialize the smtp session
			new SMTPSession(server.handlers, socket, config.secure, server, relay, config, cb);

		});

		// attach the handlers to the server
		server.handlers = mailer.getHandlers(config.handlers);

		// attach the config to the server
		server.config = config;

		// attach the server instance to the relay config
		relayConfig.server = server;

		// setup the relay
		relay = require('./smtp-relay')(relayConfig);
		relay.start(function(err) {
			if (err) console.log('error starting relay qeue:', err);
		});

		// generate a apiUser object that is implicitly allowed to send mails authenticated
		server.apiUser = {
			username: uuid.v4(),
			password: uuid.v4()
		}

		// add a send function to the server, that allows to send mails though the server interface
		server.sendMail = function(message, cb/*err*/) {
			if (!_.isObject(message)) return cb(new Error('sendMail: message must be an object'));
			var transport = nodemailer.createTransport({
				send: function(mail, cb) {
					var client = SMTPClient({
						identity: message.identity || 'api',
						host: '127.0.0.1',
						port: config.port,
						logger: config.logger,
						login: {
							user: server.apiUser.username,
							pass: server.apiUser.password
						}
					});
					client.send(mail.data.envelope || mail.message.getEnvelope(), mail.message.createReadStream(), cb);
				}
			});
			transport.sendMail(message, cb);
		}

		// listen
		server.listen(config.port);

		// return the server
		return server;

	},

	/**
	 * A list of predefined command handlers
	 */
	getHandlers: function(handlers) {

		// the directory path of our core plugins
		var corePluginDir = __dirname + '/../plugins';

		// the handlers that will be returned later on
		var plugins = _.isObject(handlers) ? _.cloneDeep(handlers) : {};

		// get all plugins
		var commands = fs.readdirSync(corePluginDir);

		// go over the commands, make sure it is a folder
		commands.forEach(function(command) {

			var stats = fs.statSync(corePluginDir + '/' + command);
			if (stats.isDirectory()) {

				// scan the command dir for plugins
				var commands = fs.readdirSync(corePluginDir + '/' + command);

				// check if the plugin is a file ending on .js
				commands.forEach(function(pluginName) {

					// make sure the plugin ends on .js
					if (pluginName.split('.')[pluginName.split('.').length - 1] !== 'js') return;

					// if it is a file, require it
					if (fs.statSync(corePluginDir + '/' + command + '/' + pluginName).isFile()) {
						if (!_.isArray(plugins[command])) plugins[command] = [];
						var module = require(corePluginDir + '/' + command + '/' + pluginName);

						// a module has to expose an object containing a handler function
						if (!_.isObject(module)) return console.log('plugin "' + pluginName + '" does not expose an object. ignoring.');
						if (!_.isFunction(module.handler)) return console.log('plugin "' + pluginName + '" does not expose a "handle" function. ignoring.');
						plugins[command].push({ name: pluginName.split('.')[0] , handler: module.handler, requires: module.requires || []});
					}

				});

			}

			// sort modules by their dependencies
			// uses the topsort algorithm to get
			// the dependency chain right
			var edges = [];

			plugins[command].forEach(function(plugin) {
				plugin.requires.forEach(function(dep) {
					// if the dependency was provided as cmd/plugin, ignore the cmd/ part
					if (dep && dep.split('/')[1]) dep = dep.split('/')[1];
					edges.push([dep, plugin.name]);
				});
			});

			var sorted = [];
			var unsorted = [];

			plugins[command].forEach(function(plugin) {
				var idx = topsort(edges).indexOf(plugin.name);
				idx === -1 ? unsorted.push(plugin) : sorted[idx] = plugin;
			});

			plugins[command] = unsorted.concat(sorted);

		});

		return plugins;

	}

}

module.exports = mailer;
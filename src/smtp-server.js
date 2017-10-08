// external dependencies
const _ = require('lodash');
const extend = require('extend');
const net = require('net');
const tls = require('tls');
const os = require('os');
const fs = require('fs');
const util = require('util');
const path = require('path');
const uuid = require('node-uuid');
const nodemailer = require('nodemailer');

// internal dependencies
const SMTPUtil = require('./smtp-util');
const SMTPClient = require('./smtp-client');
const SMTPSession = require('./smtp-session');
const SMTPRelay = require('./smtp-relay');

/**
 * The SMTP server instance
 */
class SMTPServer extends net.Server {
	
	/**
	 * Creates a new SMTP server instance.
	 * 
	 * @param {object} config
	 * The SMTP server configuration, with the following options:
	 * 
	 * @param {array} config.domains
	 * The domains that are served by this server instance.
	 * This is used for relay protection.
	 * 
	 * @param {string} [config.hostname=os.hostname()]
	 * The hostname of this server that is announced in the HELO and EHLO
	 * 
	 * @param {string} [config.greeting="mail-io"]
	 * The greeting that is sent from the server on client connection
	 * 
	 * @param {object} [config.handlers={}]
	 * A list of additional command handlers. This should be a map with "event"
	 * as the key and an array of handler definition objects as the value.
	 * Handler definition objects have to look like this:
	 * { name: 'myhandler', requires: ['some/dependency'], handler: async (req, res) => ... }
	 * 
	 * @param {object} [config.tls]
	 * The TLS configuration
	 * 
	 * @param {string|Buffer} [config.tls.key]
	 * The TLS key, will use a test key by default
	 * 
	 * @param {string|Buffer} [config.tls.cert]
	 * The TLS Certificate, will use a test cert by default
	 * 
	 * @param {string|Buffer} [config.tls.ca]
	 * The TLS CA, will use a test ca by default
	 * 
	 * @param {string} [config.tls.ciphers]
	 * A string with supported ciphers
	 * 
	 * @param {boolean} [config.tls.honorCipherOrder=true]
	 * Should we use the order of the cyphers that from the cyphers string
	 * 
	 * @param {object} [config.relay]
	 * The relay configuration
	 * 
	 * @param {boolean} [config.relay.enabled=false]
	 * Should we enable relaying mail
	 * 
	 * @param {string} [config.relay.hostname=os.hostname()]
	 * The hostname that is used during the HELO/EHLO greeting when relaying
	 * 
	 * @param {string} [config.relay.queueDir="{tmpdir}/mail-io-queue"]
	 * The directory where queued emails will be stored
	 * 
	 * @param {number} [config.relay.retryHours=48]
	 * The amount of hours we will try to submit failed messages until we finally give up
	 * 
	 * @param {number} [config.relay.retryBaseInterval=60]
	 * The base interval between retries in seconds. This number will be multiplied with
	 * the failed attempts to avoid spamming
	 * 
	 * @param {number} [config.relay.concurrentTransactions=5]
	 * The maximum number of concurrent relay transactions
	 * 
	 * @param {boolean} [config.relay.allowUnauthenticated=false]
	 * Allow relay to foreign domains or between local domains if the sender is not
	 * authenticated 
	 * 
	 * @param {boolean} [config.relay.openRelay=false]
	 * Allow to relay mail from senders that do not belong to our served domains (config.domains)
	 * 
	 * @param {number} [config.relay.smtpPort=25]
	 * The port to use when connecting to a foreign SMTP server, defaults to 25
	 * 
	 * @param {object} [config.plugins]
	 * Allows to overwrite the plugin configuration. Key should be the name of the plugin
	 * and the value an object with the configuration for that plugin, e.g.: 
	 * { 
	 * 	 "ehlo/core": {
	 *     features: ['STARTTLS', 'AUTH LOGIN PLAIN', '8BITMIME', 'PIPELINING', 'SIZE']
	 *   }
	 * }
	 * 
	 * @param {object} [config.limits]
	 * Allows to configure server imposed limits
	 * 
	 * @param {number} [config.limits.idleTimeout=60000]
	 * The maximum time in ms a connection can idle before getting disconnected
	 * 
	 * @param {number} [config.limits.messageSize=100MB]
	 * The maximum message size in bytes
	 * 
	 * @param {number} [config.limits.authFailures=5]
	 * The maximum number of authentication failures before the client is disconnected
	 * 
	 * @param {number} [config.limits.unrecognizedCommands=5]
	 * The maximum number of unrecognized commands before the client is disconnected
	 * 
	 * @param {number} [config.limits.maxConnections=100]
	 * The maximum number of concurrent inbound connections
	 * 
	 * @param {number} [config.limits.maxRecipients=100]
	 * The maximum number of recipients allowed
	 * 
	 * @param {object} [config.logger]
	 * An object with the debug levels as the key, and the logging function
	 * as the value. Supported keys are "debug", "verbose", "info", "warn", "error"
	 */
	constructor(config, cb/*session*/) {
		
		// initialize net server
		super();
		
		// the configuration, merged with the config that is passed
		config = this.config = extend(true, {
			// the hostname for the greeting
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
				// should we relay messages?
				enabled: true,
				// the hostname used during the HELO/EHLO greeting when relaying
				hostname: os.hostname(),
				// the directory to store mails in until they are delivered
				queueDir: path.join(os.tmpdir(), 'mail-io-queue'),
				// how many hours should we try to submit failed messages until finally giving up
				retryHours: 48,
				// the base interval between retries in seconds
				retryBaseInterval: 60,
				// the maximum amount of concurrent relay transactions
				concurrentTransactions: 5,
				// allow relay to foreign domains or between local domains if the sender is not authenticated?
				allowUnauthenticated: false,
				// do we relay mail from senders that do not belong to our served domains (config.domains)?
				openRelay: false,
				// the default port to connect to when establishing a connection with a foreign SMTP server (best used for testing)
				smtpPort: 25
			},
			// plugin configuration
			plugins: {
				'ehlo/core': {
					// a list of supported SMTP extensions
					features: ['STARTTLS', 'AUTH LOGIN PLAIN', '8BITMIME', 'PIPELINING', 'SIZE']
				},
				'rcpt/dnsbl': {
					// the blacklist service to use for DNSBL filtering
					blacklist: 'zen.spamhaus.org',
					// the dns server used to resolve the listing
					// note: when using google public dns servers, some dnsbl services like spamhaus won't resolve properly
					// so you can set a different dns resolver here
					resolver: '208.67.222.222'
				},
				'queue/spamd': {
					// messages that score higher than the baseScore will be treated as spam
					baseScore: 5
				},
				'queue/maildir': {
					// maildir storage location. %n will be replaced with the username and %d with the domain name
					mailDir: path.join(os.tmpdir(), 'mail-io-maildir', '%d', '%n')
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
			// tls configuration, we use our test certs by default,
			// customers should use their own certs!
			tls: {
				key: fs.readFileSync(path.join(__dirname, '..', 'keys', 'key.pem')),
				cert: fs.readFileSync(path.join(__dirname, '..', 'keys', 'cert.pem')),
				ca: fs.readFileSync(path.join(__dirname, '..', 'keys', 'ca.pem')),
				ciphers: 'ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA',
				honorCipherOrder: true
			}
		}, config);
		
		// register handlers
		this.handlers = SMTPUtil.getHandlers(config.handlers, config);
		
		// initialize the relay
		this.relay = new SMTPRelay(this);
		
		// start the relay
		if (config.relay.enabled) {
			this.relay.start().catch((err) => console.log('Error starting SMTP relay:', err));
		}
		
		// generate an apiUser object that is implicitly allowed to send mails authenticated
		this.apiUser = {
			username: uuid.v4(),
			password: uuid.v4()
		};
		
		// fix a bug in node that causes a requestOSCP request to fail if the server instance is not created with tls
		// see https://github.com/joyent/node/blob/master/lib/_tls_wrap.js#L134
		this._sharedCreds = tls.createSecureContext(config.tls);
		
		// dispatch connections
		this.on('connection', (socket) => {

			// set an idle timeout for the socket
			socket.setTimeout(this.config.limits.idleTimeout);

			// add socket.close method, which really closes the connection
			socket.close = (data) => {

				// only continue if the socket is not already destroyed
				if (socket.destroyed) return;

				// destroy immediately if no data is passed, or if the socket is not writeable
				if (!data || !socket.writable) {
					socket.end();
					return socket.destroy();
				};

				// write the data to the socket, then destroy it
				socket.write(data, () => {
					socket.end();
					socket.destroy();
				});

			};

			// initialize the smtp session
			new SMTPSession(socket, this, (session) => {
				
				// run the session callback listener
				if (_.isFunction(cb)) cb(session);
				
				// emit the session
				this.emit('session', session)				
				
			});

		});
		
	}
	
	/**
	 * The port the server is listening on. Only available
	 * after the listening event was emitted.
	 */
	get port() {
		
		const addr = this.address();
		return addr ? addr.port : null;
		
	}
	
	/**
	 * Adds a command hanlder to the server
	 * 
	 * @param {string} event
	 * The name of the command / event
	 * 
	 * @param {object} definition
	 * An object with the handler description:
	 * 
	 * @param {string} definition.name
	 * The name of the handler, will be used for logging and
	 * can later be referenced by via "<event>/<definition.name>"
	 * 
	 * @param {function} definition.handler
	 * The handler callback function that will be invoked with the
	 * "req" and "res" objects.
	 */
	addHandler(event, definition) {
		
		if (!_.isString(event)) throw new Error('event must be a string');
		if (!_.isObject(definition)) throw new Error('handler definition must be an object');
		if (!_.isString(definition.name)) throw new Error('definition has to provide a "name" for the handler');
		if (!_.isFunction(definition.handler)) throw new Error('definition has to provide a "handler" function');

		if (!_.isArray(this.handlers[event])) this.handlers[event] = [];
		this.handlers[event].push(definition);
		SMTPUtil.sortHandlers(this.handlers);
		
	}
	
	/**
	 * Sends a mail through the server. Using this function, the connection
	 * will be implicitly authencticated, so you don't have to worry about
	 * the connection itself.
	 * 
	 * @param {object} message
	 * The message object, should be compatible the nodemailer api
	 * 
	 * @return {Promise}
	 * A promise that either resolves if the mail was sent successfully, or
	 * gets rejected with an error if we failed to deliver the mail.
	 */
	async sendMail(message) {
		
		// make sure a valid looking message was passed
		if (!_.isObject(message)) throw new TypeError('sendMail: message must be an object');
	
		// create a new transport (we do this to get a proper message)
		const transport = nodemailer.createTransport({
			
			// send implementation
			send: (mail, cb) => {
				
				// create a new smtp client to send it out
				let client = new SMTPClient({
					identity: message.identity || 'api',
					host: '127.0.0.1',
					port: this.port,
					logger: this.config.logger,
					login: {
						user: this.apiUser.username,
						pass: this.apiUser.password
					}
				});
				
				// send the mail via the client
				client.send(mail.data.envelope || mail.message.getEnvelope(), mail.message.createReadStream()).then(() => cb()).catch((err) => cb(err));
				
			}
			
		});
		
		// send the mail using our transport
		return new Promise((resolve, reject) => transport.sendMail(message, (err) => {
			err ? reject(err) : resolve()
		}));
		
	}
	
}

module.exports = SMTPServer;
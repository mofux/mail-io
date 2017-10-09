// external dependencies
const _ = require('lodash');
const extend = require('extend');
const colors = require('colors/safe');
const uuid = require('node-uuid');
const hostname = require('os').hostname();
const SMTPConnection = require('smtp-connection');

// internal dependencies
const SMTPLogger = require('./smtp-logger');

/**
 * A SMTP client that is used internally for relaying and
 * also for sending emails through the server `sendMail` API
 */
class SMTPClient {
	
	/**
	 * Creates a new SMTP client
	 * 
	 * @param {object} config
	 * The client configuration
	 * 
	 * @param {string} [config.name = os.hostname]
	 * The name that is announced in the HELO/EHLO
	 * 
	 * @param {object} [config.tls]
	 * Optional, additional TLS settings
	 * 
	 * @param {number} [config.greetingTimeout = 120s]
	 * The time in ms the client will wait for the server to greet
	 * before giving up the connection
	 * 
	 * @param {number} [config.socketTimeout = 120s]
	 * The time in ms the client will maintain a connection while
	 * no data is received on the socket
	 * 
	 * @param {number} [config.connectionTimeout = 120s]
	 * The time the client will wait for the connection to be established
	 * before giving up
	 * 
	 * @param {object} [config.logger]
	 * An optional object with the level as the key, and the logging function
	 * as the value
	 * 
	 * @param {boolean} [config.debug = true]
	 * If true, the client will log
	 * 
	 * @param {string} [config.identity = "client"]
	 * A name of the client identity, will be added to the log
	 */
	constructor(config) {
		
		// merge the default configuration with the config passed
		config = this.config = extend(true, {
			name: hostname,
			tls: {
				rejectUnauthorized: false
			},
			greetingTimeout: 120 * 1000,
			socketTimeout: 120 * 1000,
			connectionTimeout: 120 * 1000,
			debug: true,
			logger: {
				info: console.log,
				warn: console.log,
				error: console.log,
				verbose: console.log,
				debug: console.log
			},
			identity: 'client'
		}, config);
		
		// create a logger for the client
		this.logger = new SMTPLogger(config.logger);
		
	}
	
	/**
	 * Sends a message
	 * 
	 * @param {object} envelope
	 * The message envelope
	 * 
	 * @param {string} envelope.from
	 * The sender address
	 * 
	 * @param {string|array} envelope.to
	 * The recipeint address, on an array of recipient addresses
	 * 
	 * @param {number} [envelope.size]
	 * An optional value of the predicted size of the message in bytes. This value is used if the server supports the SIZE extension (RFC1870)
	 * 
	 * @param {boolean} [envelope.use8BitMime = false]
	 * If true then inform the server that this message might contain bytes outside 7bit ascii range
	 * 
	 * @param {object} [envelope.dsn]
	 * Optional DSN options (Delivery Status Notification), see: 
	 * https://www.lifewire.com/what-is-dsn-delivery-status-notification-for-smtp-email-3860942
	 * 
	 * @param {string} [envelope.dsn.ret]
	 * Return either the full message ‘FULL’ or only headers ‘HDRS’
	 * 
	 * @param {string} [envelope.dsn.envid]
	 * Sender’s ‘envelope identifier’ for tracking
	 * 
	 * @param {string|array} [envelope.dsn.notify]
	 * When to send a DSN. Multiple options are OK - array or comma delimited. 
	 * NEVER must appear by itself. Available options: ‘NEVER’, ‘SUCCESS’, ‘FAILURE’, ‘DELAY’
	 * 
	 * @param {string} [envelope.dsn.orcpt]
	 * Original recipient
	 * 
	 * @param {string|Buffer|stream.Readable} message
	 * Either a String, Buffer or a Stream. All newlines are converted to \r\n and all dots are escaped automatically, no need to convert anything before.
	 */
	async send(envelope, message) {
				
		// get hold of the config and logger
		let config = extend(true, {}, this.config);
		let logger = this.logger;

		// unique id to identify the message in the log
		let id = uuid.v1();
		
		// create a logger
		Object.keys(logger.levels).forEach((level) => {

			// create a logger for every level
			config.logger[level] = (entry, message) => {
				
				// only log on client and server events
				if (!entry || !_.isString(message) || !['client', 'server'].includes(entry.tnx)) return;

				// log every line of the message separately
				message.split('\n').forEach((line) => {
					if (!line.trim().length) return;
					let code = line.split(' ')[0];
					let data = line;
					if (code && code.length === 3) data = line.split(' ').slice(1).join(' ');
					logger.log('protocol', id, null, config.identity, entry.tnx === 'server' ? 'in' : 'out', entry.tnx === 'server' ? 'in' : 'out', {
						code: code && code.length === 3 ? code : undefined,
						message: data
					});
				});

			}

		});
		
		// wrap the connection logic into a promise, which makes it easier
		// to deal with connection events
		return new Promise((resolve, reject) => {

			// create a new SMTP connection using the passed configuration
			let connection = new SMTPConnection(config);
			
			// called when we finished or failed
			let done = (err) => {

				// log the error
				if (err) {

					// use the logger to report back
					logger.log('warn', id, null, config.identity, 'error', null, { message: `Failed to deliver message for ${[].concat(envelope.to).join(', ')}: `, data: err.message || err });

				}
				
				// end the connection
				connection.quit();
				connection.close();
				err ? reject(err) : resolve();

			}
			
			// catch errors (e.g. timeout)
			connection.on('error', (err) => done(err));
			
			// run the client workflow through an async wrapper, this makes
			// it much easier to deal with the branched logic
			(async () => {
				
				// connect
				await new Promise((res, rej) => connection.connect((err) => err ? rej(err) : res()));
				
				// login
				if (config.login) await new Promise((res, rej) => connection.login(config.login, (err) => err ? rej(err) : res()));
				
				// send
				await new Promise((res, rej) => connection.send(envelope, message, (err) => err ? rej(err) : res()));
				
			})().then(() => done()).catch((err) => done(err));
			
		});
		
	}
	
}

module.exports = SMTPClient;
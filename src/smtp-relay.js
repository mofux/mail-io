// external dependencies
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns');
const _ = require('lodash');
const mkdirp = require('mkdirp');
const util = require('util');
const extend = require('extend');
const uuid = require('node-uuid');

// internal dependencies
const SMTPLogger = require('./smtp-logger');
const SMTPClient = require('./smtp-client');
const SMTPUtil = require('./smtp-util');

/**
 * Provides a facility to relay messages using a filesytem backed
 * queue that persists throughout restarts.
 */
class SMTPRelay {
	
	/**
	 * Creates a new relay
	 * 
	 * @param {SMTPServer} server
	 * The server that initiates this relay
	 */
	constructor(server) {
		
		// reference server
		this.server = server;
		
		// merge relay configuration with defaults
		let config = this.config = extend(true, {
			// the hostname to announce during the HELO / EHLO command
			hostname: os.hostname(),
			// the temporary directory used to queue messages
			queueDir: path.join(os.tmpdir(), 'mail-io-queue'),
			// the maximum amount of time we will try to deliver a mail before
			// sending an NDR
			retryHours: 48,
			// retry sending failed mails every x seconds (defaults to 1 minute)
			// with every failed attempt, this interval is multiplicated with the power of
			// failed attempts, so the time between the retry operations will increase with every attempt
			retryBaseInterval: 60,
			// the amount of concurrent transactions
			concurrentTransactions: 5,
			// the default port to connect to when establishing a connection with a foreign SMTP server (best used for testing)
			smtpPort: 25,
			// the logger to use
			logger: server.config.logger
		}, server.config.relay);
		
		// create local logging facility
		this.logger = new SMTPLogger(server.config.logger);
		this.log = {};
		Object.keys(this.logger.levels).forEach((level) => {
			this.log[level] = (mail, action, code, data, mode, dim) => {
				this.logger.log(level, mail.id, mail.failures.length, 'relay', action, mode, { code: code, message: data }, dim);
			}
		});
		
		// create the internal queue, due queued items will call this.process
		let cfg = { concurrency: this.config.concurrentTransactions || 5, interval: 1000 };
		this.queue = SMTPUtil.queue(cfg, (mail, cb) => {
			this.process(mail).then(() => cb()).catch((err) => cb(err))
		});
		
		
		
	}
	
	/**
	 * Starts the relay daemon
	 * 
	 * @return {Promise}
	 * A promise that resolves once the daemon is initialized, or rejects
	 * if starting the daemon has failed
	 */
	async start() {
		
		// simply reload
		return this.reload();
		
	}
	
	/**
	 * Reloads the active mail queue
	 */
	async reload() {
		
		// try to create the queue directory if it does not yet exist
		if (!(await SMTPUtil.exists(this.config.queueDir))) {
			await SMTPUtil.mkdirp(this.config.queueDir);
		}
		
		// read all queued mails from the queue dir
		let files = await SMTPUtil.readDir(this.config.queueDir);
		
		// load all files
		for (let file of files) {
			
			// skip files that are not ending on .meta.info
			if (file.split('.')[2] !== 'info') continue;
		
			// resolve the full path to the file
			let infoFile = path.join(this.config.queueDir, file);
		
			try {
				
				// parse the file contents and schedule it
				let content = await SMTPUtil.readFile(infoFile);
				let mail = JSON.parse(content);
				this.queue.schedule(0, mail);
				
			} catch (ex) {
				
				// failed to read or parse the file
				throw new Error(`Failed to parse mail stats from file "${infoFile}": ${ex.message || ex}`);
				
			}
			
		}
		
	}
	
	/**
	 * Processes a mail from the queue
	 * 
	 * @param {object} mail
	 * The mail object to process
	 * 
	 * @return {Promise}
	 * A promise that resolves once the mail was processed, or reject with an error if failed
	 */
	async process(mail) {

		// check if the mail is still deliverable
		if (new Date(mail.created) > new Date(new Date().getTime() - (this.config.retryHours * 60 * 60 * 1000))) {

			try {
				
				// log it
				this.log.verbose(mail, 'process', null, `Sending mail to "${mail.envelope.to}"`);
				
				// try to send it and then remove it from the queue
				await this.send(mail);
				await this.remove(mail);
				return;
				
			} catch (err) {
				
				// failed to send the mail
				mail.failures.push({ date: new Date(), err: err });
				
				// mail was not submitted successfully, check if the failure is permanent
				if (err.permanent) {
					
					// permanent error, send a ndr back to the sender and remove the mail
					await this.ndr(mail);
					await this.remove(mail);
					
				} else {
					
					// error is not permanent, update the mail and resubmit it to the queue
					let retry = (mail.failures.length || 1) * (mail.failures.length || 1) * this.config.retryBaseInterval;
					this.log.warn(mail, 'retry', null, 'Temporary error - trying again in ' + retry + 's', 'warn');
					mail.updated = new Date();
					await this.update(mail);
					this.queue.schedule(retry * 1000, mail);
					
				}
				
			}
			
		} else {
			
			// log it
			this.log.verbose(mail, 'ndr', null, `Sending NDR for undeliverable mail to "${mail.envelope.from}"`);
			
			// we have tried long enough, lets give up
			await this.ndr(mail);
			await this.remove(mail);
			
		}
		
	}
	
	/**
	 * Sends the mail
	 */
	async send(mail) {
		
		// make sure the mail object is valid
		if (!mail || !mail.envelope || !mail.envelope.from || !mail.envelope.to) throw new Error({ permanent: true, msg: 'Cannot send message because it contains an invalid envelope' });

		// get recipients
		let recipients = [].concat(mail.envelope.to || []);
		
		// run a mail transaction for every recipient
		await Promise.all(recipients.map((to) => {
			
			return (async () => {
				
				// resolve the recipient's mail server
				let domain = to.split('@')[1];
				if (!domain) throw new Error({ permanent: true, msg: `Invalid domain for recipient "${to}"` });
				
				// get the mx hosts for this domain
				let hosts = await SMTPUtil.resolveDNS(domain, 'MX').catch(() => []);

				// if we failed to resolve the mx hosts, use the domain name instead
				if (!_.isArray(hosts) || !hosts.length) hosts = [{ priority: 10, exchange: domain }];

				// validate entries and sort them by lowest priority first
				hosts = hosts.filter(function (host) {
					return host && _.isString(host.exchange) && host.exchange.length;
				}).sort(function (a, b) {
					if (!_.isNumber(b)) return -1;
					if (!_.isNumber(a)) return 1;
					if (a.priority < b.priority) return -1;
					if (a.priority > b.priority) return 1;
					return 0;
				}).map(function (host) {
					return host.exchange;
				});
				
				// holds intermediate errors
				let errors = [];
				
				// try hosts in chain
				for (let host of hosts) {
					
					// get the ip address of the host
					let targets = await SMTPUtil.resolveDNS(host, 'A').catch((err) => ({ error: err }));
					
					// if we failed to resolve, skip to the next host
					if (!targets || !targets[0] || targets.error) {
						
						errors.push({ permanent: false, msg: `[${host}]: Failed to resolve A record for host "${host}": ${targets && targets.error ? targets.error : 'hostname not resolvable'}` });
						continue;
						
					}
					
					// get a reference to the target
					let target = targets[0];
					
					// configure the smtp client
					let client = new SMTPClient({
						name: this.config.hostname,
						host: target,
						port: this.config.smtpPort || 25,
						logger: this.config.logger,
						identity: 'relay'
					});
					
					// try to send it
					try {
						
						// send the mail
						await client.send(mail.envelope, fs.createReadStream(mail.file));	
						
						// success! return here, which should skip the remaining code paths
						return;
						
					} catch (err) {
						
						// add the error to the stack
						err.responseCode ?
							errors.push({ permanent: err.responseCode >= 500, msg: `[${target}]:' ${err.response}` }) :
							errors.push({ permanent: false, msg: '[' + target + ']:' + err.message });
							
					}
					
				}
				
				// if we made it until there, the mail was not sent successfully
				// and we failed to deliver the message to any of the mx targets
				let error = { permanent: true, msg: errors.length ? '' : 'failed to resolve any target hosts' };

				// iterate the errors and add them
				errors.forEach(function (err, i) {

					// if there was a non-permanent error, we will want to retry sending later again
					if (!err.permanent) error.permanent = false;

					// add a break for multiple host errors
					if (i > 0) error.msg += '\n';

					// add the error message text
					error.msg += err.msg;

				});
				
				// throw the error(s)
				throw new Error(error);
				
			})();
			
		}));
		
	}
	
	/**
	 * Adds a message to the sending queue
	 */
	async add(envelope, message, headers) {
		
		// verify envelope data
		if (!_.isObject(envelope)) throw new Error('Invalid envelope passed, expected an object');
		if (!_.isString(envelope.from) || !envelope.from.length) throw new Error('Invalid sender');
		if (!envelope.to || !envelope.to.length) throw new Error('Invalid recipients');
		if (!message || !message.pipe) throw new Error('Invalid message, expecting a readable stream');
		
		// create the queue directory if it does not yet exist
		if (!(await SMTPUtil.exists(this.config.queueDir))) await SMTPUtil.mkdirp(this.config.queueDir);
		
		// get recipients
		let recipients = [].concat(envelope.to);
		
		// create a queued message for every recipient
		for (let to of recipients) {
			
			let id = uuid.v1();
			let messageFile = path.join(this.config.queueDir, `${id}.msg`);
			let metaFile = path.join(this.config.queueDir, `${id}.msg.info`);
			
			// write the message to the queue folder
			await new Promise((resolve, reject) => {

				// write the message to the queue folder
				let messageStream = fs.createWriteStream(messageFile);
				
				message
					.once('error', () => reject(`Failed to write message to file ${messageFile}: ${err}`))
					.once('end', () => resolve())
					.pipe(messageStream);
				
			});
			
			// collect meta file information
			let meta = {
				id: id,
				file: messageFile,
				meta: metaFile,
				envelope: {
					from: envelope.from,
					to: to
				},
				headers: headers,
				created: new Date(),
				updated: null,
				failures: []
			};
			
			// write the meta file
			await SMTPUtil.writeFile(metaFile, JSON.stringify(meta));
			
			// schedule it
			this.queue.schedule(0, meta);
			this.log.verbose(meta, 'queue', null, `Queued mail to "${to}" for delivery`);
			
		}
		
	}
	
	/**
	 * Updates the mail meta data on the disk
	 */
	async update(mail) {
		
		return SMTPUtil.writeFile(mail.meta, JSON.stringify(mail));
		
	}
	
	/**
	 * Removes the mail
	 */
	async remove(mail) {
		
		try {
			
			// unlink the files
			await SMTPUtil.unlink(mail.file);
			await SMTPUtil.unlink(mail.meta);
			
		} catch (ex) {
			
			// swallow the error but log it
			console.log(`Failed to remove mail meta files ${mail.file} or ${mail.meta}: ${ex.message || ex}`);
			
		}
		
	}
	
	/**
	 * Sends a non deliverable report (NDR) to the sender
	 */
	async ndr(mail) {
		
		// we will not send an ndr if the message sent to us was already bounced (or in any way automatically generated)
		if (mail.headers && mail.headers['auto-submitted']) {
			this.log.info(mail, 'ndr', null, `Will not send ndr to "${mail.envelope.from}" because the mail was automatically generated.`);
			return;
		}

		// log it
		this.log.verbose(mail, 'ndr', null, `Sending ndr to "${mail.envelope.from}"`);

		// compose the message
		const message = {
			identity: 'ndr',
			from: `Mail Delivery System <MAILER-DAEMON@${mail.envelope.from.split('@')[1]}>`,
			to: mail.envelope.from,
			headers: {
				'Auto-Submitted': 'auto-replied'
			},
			subject: `Mail delivery to ${[].concat(mail.envelope.to).join(', ')} failed: returning message to sender`,
			text:
				'This message was created automatically by mail delivery software.\r\n\r\n' +
				'A message that you sent could not be delivered to one or more of its recipients. ' +
				'This is a permanent error. The following address(es) failed:\r\n\r\n' +
				[].concat(mail.envelope.to).join(', ') + '\r\n' +
				mail.failures[mail.failures.length - 1].err.msg + '\r\n\r\n' +
				'----- A copy of the original message is attached -----',
				attachments: [{
					filename: 'message.txt',
					path: mail.file
				}]
		}

		// send the mail using the server api
		return this.server.sendMail(message);
		
	}
	
}

module.exports = SMTPRelay;
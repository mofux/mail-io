var fs = require('fs');
var os = require('os');
var dns = require('dns');
var _ = require('lodash');
var mkdirp = require('mkdirp');
var async = require('async');
var util = require('util');
var queue = require('./queue.js');
var extend = require('extend');
var uuid = require('node-uuid');
var SMTPLogger = require('./smtp-logger');
var SMTPClient = require('./smtp-client');

module.exports = function(opts) {

	// extend the default configuration with the options provided
	var config = extend(true, {
		// the hostname to announce during the HELO / EHLO command
		hostname: os.hostname(),
		// the temporary directory used to queue messages
		queueDir: '/tmp/mail-io-queue',
		// the maximum amount of time we will try to deliver a mail before
		// sending an NDR
		retryHours: 48,
		// retry sending failed mails every x seconds (defaults to 1 minute)
		// with every failed attempt, this interval is multiplicated with the power of
		// failed attempts, so the time between the retry operations will increase with every attempt
		retryBaseInterval: 60,
		// the amount of concurrent transactions
		concurrentTransactions: 2,
		// the default port to connect to when establishing a connection with a foreign SMTP server (best used for testing)
		smtpPort: 25,
		// custom logger
		logger: {
			info: console.log,
			warn: console.log,
			error: console.log,
			verbose: console.log,
			debug: console.log
		}
	}, opts);

	var logger = SMTPLogger(config.logger);

	var relay = {

		// the active queue
		queue: queue({ concurrency: config.concurrentTransactions || 5, interval: 1000 }, function(mail, cb) { relay.process(mail, cb) }),

		// logging facility
		log: function() {

			var log = {};
			Object.keys(logger.levels).forEach(function(level) {
				log[level] = function(mail, action, code, data, mode, dim) {
					logger.log(level, mail.id, mail.failures.length, 'relay', action, mode, { code: code, message: data }, dim);
				}
			});
			return log;

		}(),

		// starts the relay daemon
		start: function(cb/*err*/) {

			relay.reload(cb);

		},

		// reloads the active mail queue
		reload: function(cb/*err*/) {

			// read all queued mails from the queue dir
			fs.readdir(config.queueDir, function(err, files) {

				if (err) return cb('failed to load file listing from queue folder "' + config.queueDir + '": ' + err);

				// load all files
				async.each(files, function(file, cb) {

					// load the meta information files
					if (file.split('.')[2] === 'info') {

						var infoFile = config.queueDir + '/' + file;
						fs.readFile(infoFile, function(err, content) {

							// do not continue if we failed to load the queued file
							if (err) return cb('failed to read mail stats from file "' + infoFile + '": ' + err);

							// try to parse the content
							try {
								var mail = JSON.parse(content.toString());
								relay.queue.schedule(0, mail);
								return cb();
							} catch(ex) {
								return cb('failed to parse mail stats from file "' + infoFile + '": ' + ex.message);
							}

						});
					} else {

						// file is not of any interest
						return cb();

					}

				}, function done(err) {

					// all files processed
					cb(err);

				});

			});

		},

		// processes the queue
		process: function(mail, cb) {

			// check if the mail is still deliverable
			if (new Date(mail.created) > new Date(new Date().getTime() - (config.retryHours * 60 * 60 * 1000))) {

				// mail is due for resubmission
				relay.send(mail, function(err) {

					// if there was no error, the mail was delivered successfully and we can forget
					// about this mail
					if (!err) {
						relay.remove(mail);
						return cb();
					}

					// push the error to the mail
					mail.failures.push({ date: new Date(), err: err });

					// mail was not submitted successfully, check if the failure is permanent
					if (err.permanent) {

						// permanent error, send a ndr back to the sender
						relay.ndr(mail, function(err) {
							relay.remove(mail);
							cb();
						});

					} else {

						// error is not permanent, update the mail and resubmit it to the queue
						var retry = (mail.failures.length + 1) * (mail.failures.length + 1) * config.retryBaseInterval;
						relay.log.warn(mail, 'retry', null, 'temporary error - trying again in ' + retry + 's', 'warn');
						mail.updated = new Date();
						relay.update(mail);
						cb();
						relay.queue.schedule(retry * 1000, mail);

					}

				});

			} else {

				// send an NDR
				relay.ndr(mail, function() {
					relay.remove(mail);
					cb();
				});

			}

		},

		// tries to send a mail from the queue
		send: function(mail, cb/*err*/) {

			// make sure the mail object is valid
			if (!mail || !mail.envelope || !mail.envelope.from || !mail.envelope.to) return cb({ permanent: true, msg: 'cannot send message because it contains an invalid envelope'});

			// run a mail transaction for every recipient
			async.each([].concat(mail.envelope.to || []), function(to, cb) {

				// resolve the recipient's mail server
				var domain = to.split('@')[1];
				if (!domain) return cb({ permanent: true, msg: 'invalid domain for recipient "' + to + '"'});

				// try to get the mx record for this host
				dns.resolve(domain, 'MX', function(err, hosts) {

					// if there was an error, try to resolve the A record for this domain
					var host = (err || !hosts || !hosts[0]) ? domain : hosts[0].exchange;

					// get the ip address of the host
					dns.resolve(host, 'A', function(err, hosts) {

						if (err || !hosts || !hosts[0]) return cb({ permanent: false, msg: 'failed to resolve A record for host "' + host + '": ' + (err || 'hostname not resolvable') });

						var target = hosts[0];

						var client = new SMTPClient({
							name: config.hostname,
							host: target,
							port: config.smtpPort || 25,
							logger: config.logger,
							identity: 'relay'
						});

						client.send(mail.envelope, fs.createReadStream(mail.file), function(err) {

							if (err) {
								if (err.responseCode) {
									return cb({ permanent: err.responseCode >= 500, msg: err.response });
								} else {
									return cb({ permanent: false, msg: err.message });
								}
							}

							return cb();

						});

					});

				});

			}, cb);

		},

		// adds a message to the sending queue
		add: function(envelope, message, headers, cb/*err*/) {

			// verify envelope data
			if (!_.isObject(envelope)) return cb('invalid envelope passed, expected an object');
			if (!_.isString(envelope.from) || !envelope.from.length) return cb('invalid sender');
			if (!envelope.to || !envelope.to.length) return cb('invalid recipients');
			if (!message || !message.pipe) return cb('invalid message, expecting a writable stream');

			async.series([

				function makeDir(cb) {

					// make sure the queue folder does exist
					fs.exists(config.queueDir, function(exists) {
						if (!exists) {
							mkdirp(config.queueDir, function(err) {
								return cb( err ? 'failed to created queue directory "' + config.queueDir + '": ' + err : null);
							});
						} else cb();
					});

				},
				function queueMessages(cb) {

					// create a message queue for every recipient
					async.each([].concat(envelope.to), function(to, cb) {


						// write the message and the meta information to disk
						var id = uuid.v1();
						var messageFile = config.queueDir + '/' + id + '.msg';
						var metaFile = config.queueDir + '/' + id + '.msg.info';
						var answered = false;

						// write the message to the queue folder
						var messageStream = fs.createWriteStream(messageFile);

						messageStream.once('error', function(err) {
							answered = true;
							cb('failed to write message to file "' + messageFile + '": ' + err);
						});

						message.pipe(messageStream);

						// wait for the message to finish writing
						message.once('end', function() {

							// do not continue if an error occured
							if (answered) return;

							// write the meta file information
							var meta = {
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
							}

							// write the meta data and execute callback
							fs.writeFile(metaFile, JSON.stringify(meta), function(err) {

								if (err) return cb('failed to write meta information to file "' + metaFile + '": ' + err);
								relay.queue.schedule(0, meta);
								cb();

							});

						});

					}, cb);
				}
			], cb);

		},

		// updates the mail meta data on the disk
		update: function(mail, cb) {

			// writes the contents back to disk
			fs.writeFile(mail.meta, JSON.stringify(mail), cb);

		},

		remove: function(mail) {

			// error handler
			var onError = function(err) {
				if (err) console.log('REMOVE ERR', err);
			}

			// unlink the mail files
			fs.unlink(mail.file, onError);
			fs.unlink(mail.meta, onError);

		},

		// sends a non deliverable report (NDR) to the sender
		ndr: function(mail, cb/*err, message*/) {

			// we will not send an ndr if the message sent to us was already bounced (or in any way automatically generated)
			if (mail.headers && mail.headers['auto-submitted']) {
				relay.log.warn(mail, 'ndr', null, 'will not send ndr to "' + mail.envelope.from + '" because the mail was automatically generated.');
				return cb();
			}

			relay.log.verbose(mail, 'ndr', null, 'sending ndr to "' + mail.envelope.from + '"');

			var message = {
				identity: 'ndr',
				from: 'Mail Delivery System <MAILER-DAEMON@' + mail.envelope.from.split('@')[1] + '>',
				to: mail.envelope.from,
				headers: {
					'Auto-Submitted': 'auto-replied'
				},
				subject: 'Mail delivery to ' + [].concat(mail.envelope.to).join(', ') + ' failed: returning message to sender',
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
			config.server.sendMail(message, cb);

		}
	}

	return relay;

};

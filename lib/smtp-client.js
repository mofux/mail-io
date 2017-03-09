var extend = require('extend');
var colors = require('colors/safe');
var uuid = require('node-uuid');
var async = require('async');
var SMTPConnection = require('smtp-connection');
var SMTPLogger = require('./smtp-logger');
var hostname = require('os').hostname();

module.exports = function(config) {

	// extend the configuration with our defaults
	var config = extend(true, {
		name: hostname,
		tls: {
			rejectUnauthorized: false
		},
		greetingTimeout: 120 * 1000,
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

	var logger = SMTPLogger(config.logger);

	var client = {

		send: function(envelope, message, cb/*err*/) {

			var returned = false;
			var connection = new SMTPConnection(config);
			var id = uuid.v1();

			// error handler
			var onError = function(err) {
				if (returned) return;
				logger.log('warn', id, null, config.identity, 'error', null, { message: 'failed to deliver message for ' + [].concat(envelope.to).join(', ') + ' to ' + config.host  + (config.port !== 25 ? ':' + config.port : '') + ': ', data: err.message });
				returned = true;
				cb(err);
				connection.quit();
			}

			// log the protocol output
			connection.on('log', function(entry) {

				// log protocol
				if (entry.type === 'client' || entry.type === 'server') {
					entry.message.split('\n').forEach(function(line) {
						if (!line.trim().length) return;
						var code = line.split(' ')[0];
						var data = line;
						if (code && code.length === 3) data = line.split(' ').slice(1).join(' ');
						logger.log('protocol', id, null, config.identity, entry.type === 'server' ? 'in' : 'out', entry.type === 'server' ? 'in' : 'out', {
							code: code && code.length === 3 ? code : undefined,
							message: data
						});
					});
				}

			});

			// handle client errors
			connection.on('error', onError);

			// execute the commands in chain
			async.series({
				connect: function(cb) {
					connection.connect(cb);
				},
				login: function(cb) {
					if (!config.login) return cb();
					connection.login(config.login, cb);
				},
				send: function(cb) {
					connection.send(envelope, message, cb);
				},
				quit: function(cb) {
					cb();
					connection.quit();
				}
			}, function(err) {
				if (err) return onError(err);
				if (!returned) {
					returned = true;
					cb();
				}
			});

			return connection;

		}

	}

	return client;

}
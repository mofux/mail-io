var dns = require('dns');
var crypto = require('crypto');
var util = require('util');
var colors = require('colors/safe');
var _ = require('lodash');
var uuid = require('node-uuid');
var SMTPStream = require('./smtp-stream').SMTPStream;

module.exports = function(handlers, socket, secure, server, relay, config, cb) {

	// sanitize cb
	if (!_.isFunction(cb)) cb = function() {};

	// a logger instance
	var logger = require('./smtp-logger')(config.logger);

	// create a new SMTP parser
	var connection = new SMTPStream();
	connection.socket = socket;
	connection.server = server;
	connection.busy = true;
	connection.closed = false;

	// create a session instance that we will work on
	var session = {
		// a unique id used for every connection
		id: uuid.v1(),
		// information about the connected client
		client: {
			hostname: '[' + socket.remoteAddress + ']',
			address: socket.remoteAddress
		},
		// a counter for the connection, gets increased after every DATA signal
		transaction: 0,
		// the connection object from the rai
		connection: connection,
		// a reference to the relay instance
		relay: relay,
		// a reference to the options passed in the createServer constructor
		config: config,
		// session handlers
		handlers: _.cloneDeep(handlers),
		// indicates if the session is tls encrypted
		secure: secure,
		// a list of data that can be used by plugins to store
		// session specific data. key is command/plugin
		data: {},
		// counters
		counters: {
			authFailures: 0,
			unrecognizedCommands: 0
		},
		// log session specific information
		log: function() {
			var log = {};
			Object.keys(logger.levels).forEach(function(name) {
				log[name] = function(cmd, plugin, message, dim) {
					logger.log(name, session.id, session.transaction, cmd, plugin, null, message, dim);
				}
			});
			log.protocol = function(cmd, plugin, code, data, mode, dim) {
				logger.log('protocol', session.id, session.transaction, cmd, plugin, mode, { code: code, message: data }, dim);
			};
			return log;
		}(),
		// resets the session
		reset: function() {
			// a list of commands that were accepted
			session.accepted = {};
			// a list of commands that were rejected
			session.rejected = {};
			// the envelope of the session
			session.envelope = {
				from: null,
				to: []
			}
			// the authenticated user of the session
			session.user = null;
		},
		// registers socket event listeners
		register: function(socket) {
			if (!socket) socket = connection.socket;

			// set an idle timeout for the socket
			socket.setTimeout(config.limits.idleTimeout, function onTimeout() {
				session.emit('timeout', null, function() {}, true);
			});

			// handle socket close
			socket.once('close', function() {
				connection.closed = true;
			});

			// handle socket errors
			socket.on('error', function(err) {
				if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
					session.close();
				} else {
					session.log.warn('session', 'error', err);
				}
			});

		},
		// closes the connection
		close: function(code, message) {
			if (connection.socket.writable) {
				if (code && message) connection.socket.write(code + ' ' + message + '\r\n');
				connection.socket.end();
			}
			connection.oncommand = function() {};
			connection.closed = true;
			session.log.verbose('session', 'close', { message: 'closed session with ' + session.client.hostname });
		},
		// add a handler to the session handlers
		on: function(event, handler) {
			if (!_.isFunction(cb)) return;
			if (!_.isArray(session.handlers[event])) session.handlers[event] = [];
			session.handlers[event].push({ name: 'on-' + event + '-' + session.handlers[event].length, handler: handler });
		},
		// emit an event (command)
		emit: function(command, data, cb, internal) {

			// split the command
			var cmd = {
				name: command || 'unrecognized',
				data: data
			}

			// make sure the command is case insensitive
			if (cmd.name) cmd.name = cmd.name.toLowerCase();

			// ignore any commands when connection is busy
			if (connection.busy && !internal) return cb({ reason: 'busy', code: null, message: null });

			// make sure there are handlers for this command, otherwise redirect to the unrecognized handler
			if (!session.handlers[cmd.name] || (!internal && ['connect', 'queue', 'timeout', 'relay', 'unrecognized'].indexOf(cmd.name) !== -1)) {
				cmd.name = 'unrecognized';
				cmd.data = { name: command, data: data };
			}

			// log the client command
			session.log.protocol(cmd.name, null, null, command + (_.isString(data) ? ' ' + data : ''), 'in', internal);

			// get the handlers
			var handlers = _.isArray(session.handlers[cmd.name.toLowerCase()]) ? [].concat(session.handlers[cmd.name.toLowerCase()]) : [];

			// request object that will be passed to the handler
			var req = {
				command: cmd,
				session: session
			}

			// accept string
			var accepted = [250, 'OK'];

			// runs the next command handler
			var handle = function() {

				// check if there are handlers remaining
				if (handlers.length === 0) {

					// accept the message
					session.log.protocol(cmd.name, null, accepted[0], accepted[1], 'out');
					session.accepted[cmd.name] = accepted[0];
					if (connection.socket.writable) connection.socket.write(accepted[0] + ' ' + accepted[1] + '\r\n');

					// set session specific data
					switch(cmd.name) {
						case 'rcpt':
							if (req.to && session.envelope.to.indexOf(req.to) === -1) session.envelope.to.push(req.to);
							break;
						case 'mail':
							if (req.from) session.envelope.from = req.from;
							break;
						case 'auth':
							if (req.user) session.user = req.user;
							break;
					}
					return cb(null, {reason: 'accept', code: accepted[0], message: accepted[1]});

				} else {

					// call the next handler in the chain
					var handler = handlers[0];
					handlers.shift();

					// add the plugin specific config to the request
					req.config = config.plugins && config.plugins[cmd.name + '/' + handler.name] ? config.plugins[cmd.name + '/' + handler.name] : {};

					// response object that will be passed to the handler
					var res = {
						// accepts the command and replies with a status code and message
						accept: function(code, message) {
							if (code) accepted[0] = code;
							if (message) accepted[1] = message;
							session.log.protocol(cmd.name, handler.name, accepted[0], accepted[1], 'out', true);
							handle();
						},
						// accepts the command and ends the command handler chain
						final: function(code, message) {
							session.log.protocol(cmd.name, handler.name, code, message, 'out');
							session.accepted[cmd.name] = code || true;
							if (code && message && connection.socket.writable) connection.socket.write(code + ' ' + message + '\r\n');
							return cb(null, {reason: 'ok', code: code || null, message: message || null});
						},
						// rejects the command and replies with a status code and message
						reject: function(code, message) {
							if (!code || !message) throw new Error('cannot reject without a code and a message');
							session.log.protocol(cmd.name, handler.name, code, message, 'out');
							session.rejected[cmd.name] = code;

							// special case: count the auth failures and end the session if to many auth failures happened
							if (cmd.name === 'auth') {
								session.counters.authFailures++;
								if (session.counters.authFailures > config.limits.authFailures) {
									session.close(554, 'error: too many failed authentications');
									return cb({reason: 'reject', code: 554, message: 'error: too many failed authentications'});;
								}
							}
							if (connection.socket.writable) connection.socket.write(code + ' error: ' + message + '\r\n');
							cb({reason: 'reject', code: code, message: message});
						},
						// reads the next line of data and outputs the data
						read: function(onData) {
							// install a handler that will be called when existent
							connection.$readHandler = function(data, next) {
								session.log.protocol(cmd.name, handler.name, null, data.toString(), 'in');
								// replace the original callback with the callback returned from the read
								cb = next;
								// remove the read handler
								connection.$readHandler = null;
								// call the read listener with the data
								onData(data);
							}
							// run the callback, so the next command will be read
							cb({reason: 'read', code: null, message: null});
						},
						// write to the connection
						// you still have to call accept, reject or end
						write: function(data) {
							session.log.protocol(cmd.name, handler.name, data.split(' ').length == 2 ? data.split(' ')[0] : null,  data.split(' ').length == 2 ? data.split(' ')[1] : data, 'out');
							if (connection.socket.writable) connection.socket.write(data + '\r\n');
						},
						// ends the client connection
						end: function(code, message) {
							session.log.protocol(cmd.name, handler.name, code, message, 'out');
							session.rejected[cmd.name] = code || true;
							session.close(code, message);
							return cb({reason: 'end', code: code, message: message});
						},
						// logs a message for the specific handler
						log: function() {
							var log = {};
							Object.keys(logger.levels).forEach(function(level) {
								log[level] = function(message) {
									var args = [];
									for (var i=1; i<arguments.length; i++) args.push(arguments[i]);
									logger.log(level, session.id, session.transaction, cmd.name, handler.name, null, { message: message, data: args.length ? args : undefined }, false);
								}
							});
							return log;
						}(),
						// stores session specific data
						set: function(value) {
							if (!_.isObject(session.data[cmd.name])) session.data[cmd.name] = {};
							session.data[cmd.name][handler.name] = value;
						},
						// retrieves session specific data
						get: function(handler) {
							if (!_.isString(handler)) return;
							var cmd = handler.split('/')[0];
							var plugin = handler.split('/')[1];
							if (cmd && plugin) {
								return !_.isUndefined(session.data[cmd]) && !_.isUndefined(session.data[cmd][plugin]) ? session.data[cmd][plugin] : null;
							} else  if (cmd) {
								return session.data[cmd] || null;
							}
						}
					}

					// call the handler
					try {
						handler.handler(req, res);
					} catch(ex) {
						res.log.error('caught exception, disconnecting client: ', ex);
						res.end(500, 'internal server error');
					}

				}
			}

			// handle the command
			handle();
		}
	}

	// register event handlers
	session.register();

	// reset the session
	session.reset();

	// resolve the remote hostname
	dns.reverse(socket.remoteAddress, function(err, hostnames) {

		// remember hostname
		session.client.hostname = hostnames && hostnames.shift() || '[' + socket.remoteAddress + ']';

		// call the listeners
		if (_.isFunction(cb)) cb(session);

		// emit the connect event
		session.emit('connect', session.client.hostname, function() {

			// flag the connection as not being busy
			connection.busy = false;

			// command handler
			connection.oncommand = function onCommand(command, cb) {
				// the read response handler installs a $readHandler
				// function on the connection. if it is present
				// we have to call the $read handler
				if (_.isFunction(connection.$readHandler)) {
					return connection.$readHandler(command.toString(), cb);
				}

				// parse the command into a name and a data part
				var cmd = {
					name: command.toString().split(' ')[0],
					data: command.toString().split(' ').splice(1).join(' ')
				}
				// emit the command and data
				session.emit(cmd.name, cmd.data, function(rejected, accepted) {
					if (_.isFunction(cb)) cb();
				});
			}

			// connect the socket to the SMTP parser
			socket.pipe(connection);

		}, true);

	});

}
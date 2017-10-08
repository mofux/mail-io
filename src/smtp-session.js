// external dependencies
const _ = require('lodash');
const dns = require('dns');
const uuid = require('node-uuid');

// internal dependencies
const SMTPLogger = require('./smtp-logger');
const SMTPStream = require('./smtp-stream');

/**
 * Represents a SMTP session. Whenever a client connects,
 * a new session will be spawned. The session handles the lifecycle
 * of the client connection, parses the SMTP commands and dispatches
 * them to the registered handlers.
 */
class SMTPSession {
	
	/**
	 * Creates a new session.
	 * 
	 * @param {net.Socket} socket
	 * The raw net socket that is created on client connection
	 * 
	 * @param {SMTPServer} server
	 * The SMTP server instance
	 * 
	 * @param {function} [cb]
	 * An optional callback that will be called with the session
	 * once the session is ready
	 */
	constructor(socket, server, cb/*session*/) {
				
		// make cb a noop function if not provided
		if (!_.isFunction(cb)) cb = () => {};
		
		this.socket = socket;
		this.server = server;
		
		// create a new SMTP parser
		this.connection = new SMTPStream();
		this.connection.socket = socket;
		this.connection.busy = true;
		this.connection.closed = false;
		
		// unique session id
		this.id = uuid.v1();

		// information about the connected client
		this.client = {
			hostname: '[' + socket.remoteAddress + ']',
			address: socket.remoteAddress && socket.remoteAddress.indexOf('::ffff:') === 0 && socket.remoteAddress.split('.').length === 4 ? socket.remoteAddress.replace('::ffff:', '') : socket.remoteAddress
		};
		
		// the id of the current transaction, will be increased after every DATA signal
		this.transaction = 0;
		
		// a reference to the relay to use
		this.relay = server.relay;
		
		// a reference to the configuration
		this.config = server.config;
		
		// session handlers, we clone them to make sure
		// they will not get altered throughout the way
		this.handlers = _.cloneDeep(server.handlers);
		
		// indicates if the session is tls encrypted
		this.secure = false;
		
		// a list of data that can be used by plugins to store
		// session specific data - key is command/plugin
		this.data = {};
		
		// session related counters
		this.counters = {
			authFailures: 0,
			unrecognizedCommands: 0
		};
		
		// create a logger
		this.logger = new SMTPLogger(server.config.logger);
		
		// create a session.log service
		this.log = {};
		
		// create a logging function for every level
		Object.keys(this.logger.levels).forEach((level) => {
			this.log[level] = (cmd, plugin, message, dim) => {
				this.logger.log(level, this.id, this.transaction, cmd, plugin, null, message, dim);
			};
		});
		
		// special protocol logging
		this.log.protocol = (cmd, plugin, code, data, mode, dim) => {
			this.logger.log('protocol', this.id, this.transaction, cmd, plugin, mode, { code: code, message: data }, dim);
		}
		
		// register event handlers
		this.register();
		
		// reset the session
		this.reset();
		
		// make sure we have a remote address of the client, otherwise something seems to be going wrong
		if (!this.client.address || !this.client.address.length) {
			this.log.warn('connect', 'core', 'Client provides no ip address, disconnecting');
			return socket.close();
		}
		
		// resolve the remote hostname
		dns.reverse(this.client.address, (err, hostnames) => {

			// remember hostname
			this.client.hostname = !err && hostnames && hostnames.length ? hostnames[0] : '[' + this.client.address + ']';

			// call the listener with this session
			if (_.isFunction(cb)) cb(this);

			// emit the connect event
			this.emit('connect', this.client.hostname, () => {

				// flag the connection as not being busy
				this.connection.busy = false;

				// command handler
				this.connection.oncommand = (command, cb) => {
					
					// the read response handler installs a $readHandler
					// function on the connection. if it is present
					// we have to call the $read handler
					if (_.isFunction(this.connection.$readHandler)) {
						return this.connection.$readHandler(command.toString(), cb);
					}

					// parse the command into a name and a data part
					let cmd = {
						name: command.toString().split(' ')[0],
						data: command.toString().split(' ').splice(1).join(' ')
					};
					
					// emit the command and data
					this.emit(cmd.name, cmd.data, (rejected, accepted) => {
						if (_.isFunction(cb)) cb();
					});
					
				}

				// connect the socket to the SMTP parser
				socket.pipe(this.connection);

			}, true);

		});
		
	}
	
	/**
	 * Resets the whole session
	 */
	reset() {
		
		// a list of commands that were accepted
		if (!this.accepted) this.accepted = {};
		
		// a list of commands that were rejected
		this.rejected = {};
		
		// the envelope of the session
		this.envelope = {
			from: null,
			to: []
		};
		
		// the authenticated user of the session
		this.user = null;
		
	}
	
	/**
	 * Resets the current transaction
	 */
	resetTransaction() {
		
		// reset the session envelope
		this.envelope.from = null;
		this.envelope.to = [];
		
		// reset some of the accepted commands (the ones that are transaction related)
		delete this.accepted['rcpt'];
		delete this.accepted['mail'];
		delete this.accepted['data'];
		delete this.accepted['queue'];
		
	}
	
	/**
	 * Prepares a socket
	 * 
	 * @param {net.Socket|tls.Socket} socket
	 * The socket to register
	 */
	register(socket) {
		
		// use default socket if no socket is passed
		if (!socket) socket = this.connection.socket;
		
		// idle timeout, emit to the session
		socket.once('timeout', () => {
			this.emit('timeout', null, function () { }, true);
		});

		// handle socket close
		socket.once('close', () => {
			this.connection.closed = true;
		});

		// handle socket errors
		socket.on('error', (err) => {
			if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
				this.close();
			} else {
				this.log.warn('session', 'error', err);
			}
		});
		
	}
	
	/**
	 * Closes the connection
	 * 
	 * @param {number} [code]
	 * The code to end the connecion with, if omitted nothing
	 * will be sent when closing the connection
	 * 
	 * @param {string} [message]
	 * The message to end the connection with, if omitted nothing
	 * will be sent when closing the connection
	 */
	close(code, message) {
		
		// do nothing if the connection is already closed
		if (this.connection.closed) return;
		
		// close the connection, write the end message
		this.connection.socket.close(code && message ? code + ' ' + message + '\r\n' : null);
		this.connection.oncommand = function () { };
		this.connection.closed = true;
		this.log.verbose('session', 'close', { message: 'Closed session with ' + this.client.hostname });
		
	}
	
	/**
	 * Listen to an event (command)
	 * 
	 * @param {string} event
	 * The name of the event to listen to
	 * 
	 * @param {function} handler
	 * The handler function, signature is (req, res)
	 */
	on(event, handler) {
		
		if (!_.isString(event) || !event.length) throw new TypeError('event must be a string and cannot be empty');
		if (!_.isFunction(handler)) throw new TypeError('handler must be a function');
		if (!_.isArray(this.handlers[event])) this.handlers[event] = [];
		this.handlers[event].push({ name: 'on-' + event + '-' + this.handlers[event].length, handler: handler });
		
	}
	
	/**
	 * Emit an event (command)
	 * 
	 * @param {string} command
	 * The name of the event / command, accessible to listeners
	 * via req.command.name
	 * 
	 * @param {mixed} [data]
	 * Data that is passed with the event, accessible to listeners
	 * via req.command.data
	 * 
	 * @param {function} cb
	 * Callback function that will be called once the
	 * listeners have been processed. This is useful if you want to
	 * get notified once the command has been processed.
	 * 
	 * @param {boolean} [internal=false]
	 * Used internally to signal that the event that was fired is an
	 * internal event, and not an officially supported command
	 */
	emit(command, data, cb, internal) {
		
		// get a short ref to the connection
		let connection = this.connection;
		
		// split the command
		let cmd = {
			name: command || 'unrecognized',
			data: data
		};
		
		// make sure the command is case insensitive
		if (_.isString(cmd.name)) cmd.name = cmd.name.toLowerCase();

		// ignore any commands when connection is busy
		if (connection.busy && !internal) return cb({ reason: 'busy', code: null, message: null });

		// make sure there are handlers for this command, otherwise redirect to the unrecognized handler
		if (!this.handlers[cmd.name] || (!internal && ['connect', 'queue', 'timeout', 'relay', 'unrecognized'].indexOf(cmd.name) !== -1)) {
			cmd.name = 'unrecognized';
			cmd.data = { name: command, data: data };
		}

		// log the client command
		this.log.protocol(cmd.name, null, null, command + (_.isString(data) ? ' ' + data : ''), 'in', internal);

		// get the handlers
		let handlers = _.isArray(this.handlers[cmd.name.toLowerCase()]) ? [].concat(this.handlers[cmd.name.toLowerCase()]) : [];

		// request object that will be passed to the handlers.
		// handlers can add properties to this object, so following handlers
		// may work with them
		let req = {
			command: cmd,
			session: this
		}
		
		// accept string
		let accepted = [250, 'OK'];
		
		// runs the command handler
		let handle = () => {
			
			try {
						
				// check if there are any handlers remaining
				if (handlers.length === 0) {

					// accept the message
					this.log.protocol(cmd.name, null, accepted[0], accepted[1], 'out');
					this.accepted[cmd.name] = accepted[0];
					if (connection.socket.writable) connection.socket.write(accepted[0] + ' ' + accepted[1] + '\r\n');

					// set session specific data
					switch (cmd.name) {
						case 'rcpt':
							if (req.to && this.envelope.to.indexOf(req.to) === -1) this.envelope.to.push(req.to);
							break;
						case 'mail':
							if (req.from) this.envelope.from = req.from;
							break;
						case 'auth':
							if (req.user) this.user = req.user;
							break;
					}
					
					// all handlers processed, run the callback with the final code and message
					return cb(null, { reason: 'accept', code: accepted[0], message: accepted[1] });
					
				} else {
					
					// get the next handler in the chain
					let handler = handlers.shift();
					
					// add the plugin specific config to the request
					req.config = this.config.plugins && this.config.plugins[cmd.name + '/' + handler.name] ? this.config.plugins[cmd.name + '/' + handler.name] : {};

					// response object that will be passed to the handler
					let res = {
						
						// accepts the command and replies with a status code and message
						accept: (code, message) => {
							
							if (code) accepted[0] = code;
							if (message) accepted[1] = message;
							this.log.protocol(cmd.name, handler.name, accepted[0], accepted[1], 'out', true);
							handle();
							
						},
						
						// accepts the command and ends the command handler chain
						final: (code, message) => {
							
							this.log.protocol(cmd.name, handler.name, code, message, 'out');
							this.accepted[cmd.name] = code || true;
							if (code && message && connection.socket.writable) connection.socket.write(code + ' ' + message + '\r\n');
							return cb(null, { reason: 'ok', code: code || null, message: message || null });
							
						},
						
						// rejects the command and replies with a status code and message
						reject: (code, message) => {
							
							if (!code || !message) throw new Error('Cannot reject without a code and a message');
							this.log.protocol(cmd.name, handler.name, code, message, 'out');
							this.rejected[cmd.name] = code;

							// special case: count the auth failures and end the session if to many auth failures happened
							if (cmd.name === 'auth') {
								this.counters.authFailures++;
								if (this.counters.authFailures > this.config.limits.authFailures) {
									this.close(554, 'Error: Too many failed authentications');
									return cb({ reason: 'reject', code: 554, message: 'Error: Too many failed authentications' });;
								}
							}
							
							if (connection.socket.writable) connection.socket.write(code + ' Error: ' + message + '\r\n');
							cb({ reason: 'reject', code: code, message: message });
							
						},
						
						// reads the next line of data and outputs the data
						read: (onData) => {
							
							// install a handler that will be called when existent
							connection.$readHandler = (data, next) => {
								
								// log the data
								this.log.protocol(cmd.name, handler.name, null, data.toString(), 'in');

								// replace the original callback with the callback returned from the read
								cb = next;
								
								// remove the read handler
								connection.$readHandler = null;
								
								// call the read listener with the data
								onData(data);
								
							}
							
							// run the callback, so the next command will be read
							cb({ reason: 'read', code: null, message: null });
							
						},
						
						// write to the connection
						// you still have to call accept, reject or end
						write: (data) => {
							
							this.log.protocol(cmd.name, handler.name, data.split(' ').length == 2 ? data.split(' ')[0] : null, data.split(' ').length == 2 ? data.split(' ')[1] : data, 'out');
							if (connection.socket.writable) connection.socket.write(data + '\r\n');
							
						},
						
						// ends the client connection
						end: (code, message) => {
							
							this.log.protocol(cmd.name, handler.name, code, message, 'out');
							this.rejected[cmd.name] = code || true;
							this.close(code, message);
							return cb({ reason: 'end', code: code, message: message });
							
						},
						
						// stores session specific data
						set: (value) => {
							
							if (!_.isObject(this.data[cmd.name])) this.data[cmd.name] = {};
							this.data[cmd.name][handler.name] = value;
							
						},
						
						// retrieves session specific data
						get: (handler) => {
							
							if (!_.isString(handler)) return;
							let cmd = handler.split('/')[0];
							let plugin = handler.split('/')[1];
							if (cmd && plugin) {
								return !_.isUndefined(this.data[cmd]) && !_.isUndefined(this.data[cmd][plugin]) ? this.data[cmd][plugin] : null;
							} else if (cmd) {
								return this.data[cmd] || null;
							}
							
						},
						
						// logs a message for the specific handler
						log: (() => {
							
							let log = {};
							Object.keys(this.logger.levels).forEach((level) => {
								log[level] = (message, ...args) => {
									this.logger.log(level, this.id, this.transaction, cmd.name, handler.name, null, { message: message, data: args.length ? args : undefined}, false);
								}
							});
							return log;
							
						})()
						
					};
					
					// call the handler
					try {
						handler.handler(req, res);
					} catch (ex) {
						res.log.error('Caught exception, disconnecting client: ', ex);
						res.end(500, 'Internal server error');
					}
					
				}
				
			} catch (ex) {
				
				// Uncaught error, not good. log it
				this.log.error('handler', 'uncaught', { message: `Unhandled error in a handler for command "${cmd.name}": ${ex.message || ex}`, data: ex });
				this.close(500, 'Internal server error');
				cb({ reason: 'end', code: 500, message: 'Internal server error' });
				
			}
			
		}
		
		// start to handle the command
		handle();
		
	}
	
}

module.exports = SMTPSession;
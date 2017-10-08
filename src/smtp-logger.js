const colors = require('colors/safe');
const util = require('util');
const _ = require('lodash');

/**
 * Pretty prints transaction related log information using
 * your favourite logger. Defaults to use console.log.
 */
class SMTPLogger {
	
	/**
	 * Creates a new logger.
	 * 
	 * @param {object} [logger]
	 * An object where the key is the log level, and the value
	 * is a function that can be used for logging. Defaults to
	 * console.log if not specified.
	 */
	constructor(logger) {
		
		// fallback to console.log if logger is not passed
		if (!_.isObject(logger)) logger = {}; 
		
		// the default log functions to use
		this.logger = {
			info: logger.info || console.log,
			warn: logger.warn || console.log,
			error: logger.error || console.log,
			debug: logger.debug || console.log,
			verbose: logger.verbose || console.log,
			protocol: logger.protocol || console.log
		};
		
		// a list of supported logging levels, and how they should look like
		this.levels = {
			info: { sign: 'I', fg: colors.green, bg: colors.bgGreen },
			warn: { sign: 'W', fg: colors.yellow, bg: colors.bgYellow },
			error: { sign: 'E', fg: colors.red, bg: colors.bgRed },
			verbose: { sign: 'V', fg: colors.magenta, bg: colors.bgMagenta },
			debug: { sign: 'D', fg: colors.cyan, bg: colors.bgCyan },
			protocol: { sign: 'P', fg: colors.blue, bg: colors.bgBlue }
		}
		
	}
	
	/**
	 * Creates formatted logging output
	 * @param {string} level 
	 * The logging verbosity, any of 'info', 'warn', 'error', 'verbose', 'debug'
	 * 
	 * @param {string} id 
	 * The identified of the logged context, usually a message id
	 * 
	 * @param {string} [subId]
	 * A sub-identifier of the logged context, usually a transaction id
	 * 
	 * @param {string} event 
	 * The name of the event that triggered the logging
	 * 
	 * @param {string} [subEvent] 
	 * The name of the sub-event that triggered the logging
	 * 
	 * @param {string} [type]
	 * The type of the logged context, can be "in", "out" or anything else
	 * 
	 * @param {string|object} data 
	 * The data that will be logged. can be either a string or an object containing "code", "message" and "data"
	 * 
	 * @param {boolean} [dim=false] 
	 * If true, the logged line will be dimmed
	 */
	log(level, id, subId, event, subEvent, type, data, dim) {

		let levels = this.levels;
		let output = '';

		// add a logging level indicator up front
		output += colors.white(levels[level].bg(' ' + levels[level].sign + ' ') + ' ');

		// log the id and optionally the subId
		output += id + colors.grey('#') + (subId || '0') + ' ';

		// add the event and sub event, create a fixed padding for the following text
		output += colors.green(event) + (subEvent ? colors.grey('/' + subEvent) : colors.grey(' '));
		output = (output + '                                                                          ').split('').slice(0, 115).join('');

		// add a type indicator
		switch (type) {
			case 'in': output += colors.red(' < '); break;
			case 'out': output += colors.green(' > '); break;
			case 'up': output += levels[level].fg(' ^ '); break;
			case 'down': output += levels[level].fg(' v '); break;
			case 'line': output += levels[level].fg(' | '); break;
			default: output += levels[level].fg(' \u2055 '); break;
		}

		// log the data
		if (_.isObject(data) && (data.code || data.message)) {

			// log optional code
			if (data.code) {
				let code = parseInt(data.code);
				output += ' ' + (code < 300 ? colors.cyan(code) : code < 500 ? colors.yellow(code) : colors.red(code));
			}

			// log optional message
			if (data.message) output += ' ' + data.message;

		} else if (!_.isUndefined(data)) {

			// log the data
			output += ' ';
			output += data;

		}

		// dim the output
		if (dim) output = colors.dim(output);

		// log it using the logger
		this.logger[level](output);

		// log additional data if provided
		if (data && !_.isUndefined(data.data)) {

			let additional = [].concat(data.data);
			additional.forEach((item) => {

				if (item instanceof Error) {
					let lines = (item.stack || JSON.stringify(item)).split('\n');
					lines.forEach((line, i) => {
						this.log(level, id, subId, event, subEvent, i === 0 ? 'up' : i === lines.length - 1 ? 'down' : 'line', { message: line }, dim);
					});
				} else if (_.isObject(item)) {
					let lines = util.inspect(item).split('\r\n');
					lines.forEach((line, i) => {
						this.log(level, id, subId, event, subEvent, i === 0 ? 'up' : i === lines.length - 1 ? 'down' : 'line', { message: line }, dim);
					});
				} else {
					this.log(level, id, subId, event, subEvent, 'up', { message: item }, dim);
				}

			});

		}
		
	}
	
}

module.exports = SMTPLogger;
var colors = require('colors/safe');
var util = require('util');
var _ = require('lodash');

module.exports = function(logger) {

	// default logger can be replaced by user provided loggers
	var logger = _.extend({
		info: console.log,
		warn: console.log,
		error: console.log,
		debug: console.log,
		verbose: console.log,
		protocol: console.log
	}, logger);

	var self = {

		// a list of supported logging levels, and how they should behave
		levels: {
			info: { sign: 'I', fg: colors.green, bg: colors.bgGreen },
			warn: { sign: 'W', fg: colors.yellow, bg: colors.bgYellow },
			error: { sign: 'E', fg: colors.red, bg: colors.bgRed },
			verbose: { sign: 'V', fg: colors.magenta, bg: colors.bgMagenta},
			debug: { sign: 'D', fg: colors.cyan, bg: colors.bgCyan },
			protocol: { sign: 'P', fg: colors.blue, bg: colors.bgBlue }
		},

	/**
		 * creates formatted logging output
		 * @param level The logging verbosity, any of 'info', 'warn', 'error', 'verbose', 'debug'
		 * @param id The identified of the logged context, usually a message id
		 * @param subId (optional) A sub-identifier of the logged context, usually a transaction id
		 * @param event The name of the event that triggered the logging
		 * @param subEvent (optional) The name of the sub-event that triggered the logging
		 * @param type (optional) The type of the logged context, can be "in", "out" or anything else
		 * @param data The data that will be logged. can be either a string or an object containing "code", "message" and "data"
		 * @param dim If true, the logged line will be dimmed
		 */
		log: function(level, id, subId, event, subEvent, type, data, dim) {

			var levels = self.levels;
			var output = '';

			// add a logging level indicator up front
			output += colors.white(levels[level].bg(' ' + levels[level].sign + ' ') + ' ');

			// log the id and optionally the subId
			output += id + colors.grey('#') + (subId || '0') + ' ';

			// add the event and sub event, create a fixed padding for the following text
			output += colors.green(event) + (subEvent ? colors.grey('/' + subEvent) : colors.grey(' '));
			output = (output + '                                                                          ').split('').slice(0,105).join('');

			// add a type indicator
			switch(type) {
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
					var code = parseInt(data.code);
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
			logger[level](output);

			// log additional data if provided
			if (data && !_.isUndefined(data.data)) {

				var additional = [].concat(data.data);
				additional.forEach(function(item) {

					if (item instanceof Error) {
						var lines = (item.stack || JSON.stringify(item)).split('\n');
						lines.forEach(function(line, i) {
							self.log(level, id, subId, event, subEvent, i === 0 ? 'up' : i === lines.length - 1 ? 'down' : 'line', { message: line }, dim);
						});
					} else if (_.isObject(item)) {
						var lines = util.inspect(item).split('\r\n');
						lines.forEach(function(line, i) {
							self.log(level, id, subId, event, subEvent, i === 0 ? 'up' : i === lines.length - 1 ? 'down' : 'line', { message: line }, dim);
						});
					} else {
						self.log(level, id, subId, event, subEvent,'up', { message: item }, dim);
					}

				});

			}

		}

	}

	return self;

}
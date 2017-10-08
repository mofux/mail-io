module.exports = {

	description: 'check mail content against spamassassin (needs to be installed)',
	author: 'Thomas Zilz',
	after: ['core'],
	handler: function(req, res) {

		// module dependencies
		let fs = require('fs');

		// checks the message against the spamassassin daemon
		let report = function(message, cb/*err, result*/) {

			let spamd = require('net').createConnection(783);
			let done = false;
			let response = {
				code: -1,
				message: 'FAILED',
				spam: false,
				score: 0,
				baseScore: 5,
				matches: [],
				report: []
			};

			// if the connection times out, we return an error
			spamd.setTimeout(10 * 1000, () => {

				done = true;
				return cb('connection to spamd timed out');

			});

			// once connected, send the request
			spamd.once('connect', () => {

				spamd.write('REPORT SPAMC/1.5\r\n');
				spamd.write('\r\n');
				message.on('data', (data) => spamd.write(data));
				message.once('end', () => spamd.end('\r\n'));

			});

			// catch service errors
			spamd.once('error', (err) => {
				if (!done) {
					done = true;
					return cb(err);
				}
			});

			// flag that remembers if the very first data has been received
			let first = true;

			// process the spamd response data
			spamd.on('data', (data) => {

				let lines = data.toString().split('\r\n');
				lines.forEach((line) => {
					if (first) {
						first = false;
						let result = line.match(/SPAMD\/([0-9\.\-]+)\s([0-9]+)\s([0-9A-Z_]+)/);
						if (result) {
							response.code = parseInt(result[2], 10);
							response.message = result[3];
						}
					} else {
						result = line.match(/Spam:\s(True|False|Yes|No)\s;\s([0-9\.]+)\s\/\s([0-9\.]+)/);
						if (result) {
							response.spam = result[1] == 'True' || result[1] == 'Yes' ? true : false;
							response.score = parseFloat(result[2]);
							response.baseScore = parseFloat(result[3]);
						}
						if (!result) {
							result = line.match(/([A-Z0-9\_]+)\,/g);
							if (result) response.matches = response.matches.concat(result.map(function(item) {
								return item.substring(0, item.length - 1);
							}));
						}
						if (!result) {
							result = line.match(/(\s|-)([0-9\.]+)\s([A-Z0-9\_]+)\s([^:]+)\:\s([^\n]+)/g);
							if (result) {
								response.report = response.report.concat(result.map(function(item) {
									item = item.replace(/\n([\s]*)/, ' ');
									let matches = item.match(/(\s|-)([0-9\.]+)\s([A-Z0-9\_]+)\s([^:]+)\:\s([^\s]+)/);
									return {
										score: matches && matches[2] ? matches[2] : 0,
										name: matches && matches[3] ? matches[3] : null,
										description: matches && matches[4] ? matches[4].replace(/^\s*([\S\s]*)\b\s*$/, '$1') : null,
										type: matches && matches[5] ? matches[5] : null
									}
								}));
							}
						}
					}
				});

			});

			// process the data once the connection is closed
			spamd.once('close', () => {
				if (!done) {
					done = true;
					return cb(null, response);
				}
			});

		}

		// run the report
		report(fs.createReadStream(req.command.data), (err, data) => {

			// set a spam score and publishes the result, even if an error occured,
			// in which case the score will always be 0
			let result = { score: data && data.score ? data.score : 0, baseScore: req.config.baseScore || 5, err: err || null };
			result.spam = result.score >= result.baseScore;
			res.set(result);

			if (err) {
				if (err.code === 'ECONNREFUSED') {
					res.log.verbose('Unable to connect to spamd on port 783');
				} else {
					res.log.warn('spamd encountered an error: ', err)
				}
			} else {
				res.log.verbose((result.spam ? 'spam!' : 'no spam!') + ' (' + result.score + '/' + result.baseScore + ')');
			}

			res.accept();

		});

	}

}

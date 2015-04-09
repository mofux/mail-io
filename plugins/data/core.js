module.exports = {

	description: 'core implementation for DATA command',
	author: 'Thomas Zilz',
	requires: [],
	handler: function(req, res) {

		// core modules
		var os = require('os');
		var path = require('path');
		var fs = require('fs');

		// make sure we have valid senders and recipients
		if ((!req.session.accepted.helo && !req.session.accepted.ehlo)) return res.reject(503, 'need HELO or EHLO command');
		if (!req.session.accepted.mail) return res.reject(503, 'no valid sender');
		if (!req.session.accepted.rcpt) return res.reject(503, 'no valid recipients');

		// start the data mode, attach the data stream to
		// the request, so the following listeners can use it
		req.stream = req.session.connection.startDataMode();

		// accept
		res.accept(354, 'OK');

		// write the data to a file
		var file = path.join(os.tmpDir(), req.session.id + '-' + req.session.transaction + '.msg');

		// write stream to the tmp file
		var fileStream = fs.createWriteStream(file);

		// when data is arriving, stream it to the file
		req.stream.on('data', function(data) {
			fileStream.write(data);
		});

		// stream ended
		req.stream.once('end', function() {

			// close the file stream
			fileStream.end();

			// continue in normal mode
			req.stream.removeAllListeners();
			req.session.connection.continue();

			// emit the internal 'queue' event
			req.session.emit('queue', file, function() {

				// increase the transaction
				req.session.transaction++;

				// remove the temporary file
				fs.exists(file, function(exists) {
					if (exists) fs.unlink(file, function(err) {
						if (err) res.log.warn('failed to unklink file "' + file + '": ' + err);
					});
				});

			}, true);

		});

	}
}
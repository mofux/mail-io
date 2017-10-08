module.exports = {

	description: 'core implementation for DATA command',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// core modules
		let os = require('os');
		let path = require('path');
		let fs = require('fs');
		let moment = require('moment-timezone');

		// make sure we have valid senders and recipients
		if ((!req.session.accepted.helo && !req.session.accepted.ehlo)) return res.reject(503, 'Need HELO or EHLO command');
		if (!req.session.accepted.mail) return res.reject(503, 'No valid sender');
		if (!req.session.accepted.rcpt) return res.reject(503, 'No valid recipients');

		// start the data mode, attach the data stream to
		// the request, so the following listeners can use it
		req.stream = req.session.connection.startDataMode();

		// accept
		res.accept(354, 'OK');

		// write the data to a file
		let file = path.join(os.tmpdir(), req.session.id + '-' + req.session.transaction + '.msg');

		// write stream to the tmp file
		let fileStream = fs.createWriteStream(file);

		// add received headers
		let received =
			'Received: from ' + req.session.client.hostname + ' (' + req.session.client.address + ')\n\t' +
			'by ' + req.session.config.hostname + ' (' + req.session.server.address().address + ') with ' +
			(req.session.accepted.ehlo ? 'ESMTP' : 'SMTP') + (req.session.secure ? 'S' : '') + (req.session.accepted.auth ? 'A' : '') + '; ' +
			moment().locale('en').format('ddd, DD MMM YYYY HH:mm:ss ZZ') + '\r\n';

		// write the received header to the top of the file
		fileStream.write(received);

		// when data is arriving, stream it to the file
		req.stream.on('data', (data) =>	fileStream.write(data));

		// stream ended
		req.stream.once('end', () => {

			// close the file stream
			fileStream.end();

			// continue in normal mode
			req.stream.removeAllListeners();
			req.session.connection.continue();

			// emit the internal 'queue' event
			req.session.emit('queue', file, () => {

				// reset the transaction
				req.session.resetTransaction();
				
				// increase the transaction
				req.session.transaction++;

				// remove the temporary file
				fs.exists(file, (exists) => {
					if (exists) fs.unlink(file, (err) => {
						if (err) res.log.warn('Failed to unlink file "' + file + '": ' + err);
					});
				});

			}, true);

		});

	}
}

var MailParser = require('mailparser').MailParser;
var fs = require('fs');

module.exports = {

	description: 'core implementation for the "queue" event',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// remember if the request was answered
		var answered = false;

		// for easier handling, assign the file to the req
		req.file = req.command.data;

		// parse the mail using mailparser
		var mailparser = new MailParser({
			streamAttachments: false
		});

		// mailparser finished processing the email
		mailparser.on('end', function(mail) {

			// attach the parsed mail object to the request
			req.mail = mail;

			if (!answered) {
				answered = true;
				res.accept();
			}

		});

		// handle parsing errors
		mailparser.on('error', function(err) {

			res.log.warn('failed to parse email: ', err);

			if (!answered) {
				answered = true;
				res.reject(451, 'error while parsing the mail');
			}

		});

		// create a read stream to the message file
		var fileStream = fs.createReadStream(req.file);

		// handle file errors
		fileStream.on('error', function(err) {

			res.log.warn('failed to read file "' + req.file + '": ', err);

			if (!answered) {
				answered = true;
				res.reject(451, 'error while processing the mail');
			}

		});

		// pipe the message content to mailparser
		fileStream.pipe(mailparser);

	}

}
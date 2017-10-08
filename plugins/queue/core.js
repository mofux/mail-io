let MailParser = require('mailparser').MailParser;
let fs = require('fs');

module.exports = {

	description: 'core implementation for the "queue" event',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// remember if the request was answered
		let answered = false;

		// for easier handling, assign the file to the req
		req.file = req.command.data;

		// parse the mail using mailparser
		let mailparser = new MailParser({
			streamAttachments: false
		});

		// mailparser finished processing the email
		mailparser.once('end', (mail) => {
			
			// attach the parsed mail object to the request
			req.mail = mail;

			if (!answered) {
				answered = true;
				res.accept();
			}

		});

		// handle parsing errors
		mailparser.once('error', (err) => {

			res.log.warn('Failed to parse email: ', err);

			if (!answered) {
				answered = true;
				res.reject(451, 'Error while parsing the mail');
			}

		});

		// create a read stream to the message file
		let fileStream = fs.createReadStream(req.file);

		// handle file errors
		fileStream.once('error', (err) => {

			res.log.warn('Failed to read file "' + req.file + '": ', err);

			if (!answered) {
				answered = true;
				res.reject(451, 'Error while processing the mail');
			}

		});

		// pipe the message content to mailparser
		fileStream.pipe(mailparser);

	}

}
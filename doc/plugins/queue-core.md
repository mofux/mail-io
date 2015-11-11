# queue/core

This `core` plugin adds support for the `queue` event, emitted once the `data/core` plugin has received all data from the client.

It adds `file` to the request object, which is available to all following `queue` handlers.
`file` is the path to the temporary file created by the `data/core` plugin. This file contains the RAW content of the message (including headers)
received by the client.

It also adds `mail` to the request object, which is the parsed mail content including headers and attachment (parsed using mailparser)

If no more `queue` listeners are available, this plugin will always accept the request with the message `250 OK`, which indicates to the client
that the data has been successfully processed. Once all `queue` listeners have been processed, the `data/core` plugin makes sure to delete the
temporary message file referenced in `res.file`, so please don't rely on the file always being existent.

> Note: if you want to process, modify or store the message that you received from the client, the `queue` event is the right place to go.

# example

In this example, we will parse the message using the excellent `mailparser` library, and we will save the message to a database if the
subject equals `save me`.

```javascript

var mailio = require('mail-io');
var server = mailio.createServer({}, function(session) {

	session.on('queue', function(req, res) {

		var MailParser = require('mailparser').MailParser;
		var mailparser = new MailParser();
		var fs = require('fs');

		// create a read stream to the temporary file created by the 'data/core' plugin
		var messageStream = fs.createReadStream(req.file);

		mailparser.on('end', function(mail) {

			// the mail object now contains the parsed mail object
			if (mail.subject === 'save me') {

				// do whatever is necessary to save the mail to your db backend
				db.save(mail, function(err) {

					// if there was an error saving the mail to the database, let the client know, so it can resubmit the message or notify
					// the sender about the failed transaction
					if (err) {
						res.reject(451, 'failed to persist message');
					} else {
						res.accept();
					}

				});

			} else {

				// reject the message
				res.reject(554, 'I will only store mails with subject "save me"');

			};

		});

		// stream the message content to the mail parser
		messageStream.pipe(mailparser);

	});

});

```
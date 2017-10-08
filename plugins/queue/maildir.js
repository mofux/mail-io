module.exports = {
	description: 'stores the message in the maildir format',
	author: 'Thomas Zilz',
	after: ['spamd'],
	handler: function(req, res) {

		// module dependencies
		let fs = require('fs');
		let async = require('async');
		let mkdirp = require('mkdirp');
		let path = require('path');
		let uuid = require('node-uuid');

		// a flag indicating if we have already answered
		let answered = false;

		// handler if something goes wrong
		let onError = function(err) {
			res.log.error('Error while storing message:', err);
			if (!answered) {
				res.reject(451, 'Requested action aborted - failed to store message.');
				answered = true;
			}
		}

		// a list of sender addresses (after extending them)
		let senders = [];

		// a list of recipient mail (after extending them)
		let recipients = [];

		// extend function, either from the config or a simple placeholder
		let extend = typeof(req.config.extend) === 'function' ? req.config.extend : (address, cb) => {
			return cb([address]);
		}

		async.series({
			extendSender: function(cb) {

				// only store mails for senders that belong to our domain
				if (req.session.config.domains.indexOf(req.session.envelope.from.split('@')[1]) === -1) return cb();

				extend(req.session.envelope.from, function(addresses) {
					if (addresses) senders = senders.concat(addresses);
					cb();
				});

			},
			extendRecipients: function(cb) {

				async.each(req.session.envelope.to, (recipient, cb) => {

					// only store mails for recipients that belong to our domain
					if (req.session.config.domains.indexOf(recipient.split('@')[1]) === -1) return cb();

					extend(recipient, (addresses) => {
						if (addresses) recipients = recipients.concat(addresses);
						cb();
					});

				}, cb);

			},
			processMailboxes: function(cb) {

				// a list of mailboxes that will be processed
				let mailboxes = [];

				// add mailbox entries for senders
				senders.forEach(function(address) {
					mailboxes.push({
						mailDir: req.config.mailDir.replace(/%n/g, address.split('@')[0]).replace(/%d/g, address.split('@')[1]),
						folder: '.Sent'
					});
				});

				// add mailbox entries for recipients
				recipients.forEach(function(address) {
					mailboxes.push({
						mailDir: req.config.mailDir.replace(/%n/g, address.split('@')[0]).replace(/%d/g, address.split('@')[1]),
						folder: res.get('queue/spamd').spam ? '.Junk' : ''
					});
				});

				// store the messages to the mailboxes
				async.each(mailboxes, function(mailbox, cb) {

					// configure mailbox path
					mailbox.path = path.join(mailbox.mailDir, mailbox.folder);

					res.log.verbose('Storing mail to ' + mailbox.path);

					// create mail dirs if they do not exist yet
					let dirs = ['tmp', 'new', 'cur'];

					async.each(dirs, function(dir, cb) {

						// create the folder (if it does not exist)
						mkdirp(path.join(mailbox.path, dir), cb);

					}, function foldersCreated(err) {

						if (err) return cb(err);

						// file names for different targets
						let filename = new Date().getTime() + '.' + uuid.v1() + '.' + req.session.config.hostname;
						let tmpFile = path.join(mailbox.path, 'tmp', filename);
						let finalFile = path.join(mailbox.path, 'new', filename);

						// a reference to source mail
						let message = fs.createReadStream(req.command.data);

						// try to catch errors (e.g. we cannot read the message)
						message.once('error', onError);

						// special handling for sent messages:
						// put the mail to the cur instead of the new folder, and
						// add the "Seen" (:2,S) attribute to the filename, so that
						// a client does not show this message as unread
						if (mailbox.folder === '.Sent') {
							finalFile = path.join(mailbox.path, 'cur', filename + ':2,S');
						}

						// save the message to the file
						let fileStream = fs.createWriteStream(tmpFile);

						// handle errors
						fileStream.once('error', onError);

						// stream the message to the tmp folder
						message.pipe(fileStream);

						// once the file has been written completely,
						// copy it from the tmp folder to the new folder
						fileStream.once('finish', () => {

							fs.link(tmpFile, finalFile, (err) => {

								if (err) return cb('Failed to move message from "' + tmpFile + '" to "' + finalFile + '": ' + err);

								// delete the message from tmp
								fs.unlink(tmpFile, (err) => {

									return err ? cb('Failed to delete tmp message "' + tmpFile + '": ' + err) : cb();

								});

							});

						});


					});

				}, cb);

			}
		}, (err) => {

			if (err) return onError(err);
			if (!answered) res.accept();

		});

	}
}
module.exports = {
	description: 'stores the message in the maildir format',
	author: 'Thomas Zilz',
	after: ['spamd'],
	handler: function(req, res) {

		// module dependencies
		var fs = require('fs');
		var async = require('async');
		var mkdirp = require('mkdirp');
		var path = require('path');
		var uuid = require('node-uuid');

		// a flag indicating if we have already answered
		var answered = false;

		// handler if something goes wrong
		var onError = function(err) {
			res.log.error('error while storing message:', err);
			if (!answered) {
				res.reject(451, 'requested action aborted - failed to store message.');
				answered = true;
			}
		}

		// a list of sender addresses (after extending them)
		var senders = [];

		// a list of recipient mail (after extending them)
		var recipients = [];

		// extend function, either from the config or a simple placeholder
		var extend = typeof(req.config.extend) === 'function' ? req.config.extend : function(address, cb) {
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

				async.each(req.session.envelope.to, function(recipient, cb) {

					// only store mails for recipients that belong to our domain
					if (req.session.config.domains.indexOf(recipient.split('@')[1]) === -1) return cb();

					extend(recipient, function(addresses) {
						if (addresses) recipients = recipients.concat(addresses);
						cb();
					});

				}, cb);

			},
			processMailboxes: function(cb) {

				// a list of mailboxes that will be processed
				var mailboxes = [];

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

					res.log.verbose('storing mail to ' + mailbox.path);

					// create mail dirs if they do not exist yet
					var dirs = ['tmp', 'new', 'cur'];

					async.each(dirs, function(dir, cb) {

						// create the folder (if it does not exist)
						mkdirp(path.join(mailbox.path, dir), cb);

					}, function foldersCreated(err) {

						if (err) return cb(err);

						// file names for different targets
						var filename = new Date().getTime() + '.' + uuid.v1() + '.' + req.session.config.hostname;
						var tmpFile = path.join(mailbox.path, 'tmp', filename);
						var finalFile = path.join(mailbox.path, 'new', filename);

						// a reference to source mail
						var message = fs.createReadStream(req.command.data);

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
						var fileStream = fs.createWriteStream(tmpFile);

						// handle errors
						fileStream.once('error', onError);

						// stream the message to the tmp folder
						message.pipe(fileStream);

						// once the file has been written completely,
						// copy it from the tmp folder to the new folder
						fileStream.once('finish', function() {

							fs.link(tmpFile, finalFile, function(err) {

								if (err) return cb('failed to move message from "' + tmpFile + '" to "' + finalFile + '": ' + err);

								// delete the message from tmp
								fs.unlink(tmpFile, function(err) {

									return err ? cb('failed to delete tmp message "' + tmpFile + '": ' + err) : cb();

								});

							});

						});


					});

				}, cb);

			}
		}, function mailboxesProcessed(err) {

			if (err) return onError(err);
			if (!answered) res.accept();

		});

	}
}
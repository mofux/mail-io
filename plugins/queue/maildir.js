module.exports = {
	description: 'stores the message in the maildir format',
	author: 'Thomas Zilz',
	requires: ['queue/spamd'],
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

		// check if the mail is addressed to or sent from a domain on our server
		var mailboxes = [];

		// parse the sender
		var sender = {
			username: req.session.envelope.from.split('@')[0] || '',
			domain: req.session.envelope.from.split('@')[1] || '',
			address: req.session.envelope.from
		}
		sender.mailDir = req.config.mailDir.replace(/%n/g, sender.username).replace(/%d/g, sender.domain);

		// save the message to the Sent folder of the sender
		if (req.session.config.domains.indexOf(sender.domain) !== -1) {
			mailboxes.push({
				user: sender,
				folder: '.Sent',
				path: path.join(sender.mailDir, '.Sent')
			});
		}

		// save the message to the Inbox or Junk folder of the recipient
		req.session.envelope.to.forEach(function(to) {

			var rcpt = {
				username: to.split('@')[0] || '',
				domain: to.split('@')[1] || '',
				address: to
			}
			rcpt.mailDir = req.config.mailDir.replace(/%n/g, rcpt.username).replace(/%d/g,rcpt.domain);

			if (req.session.config.domains.indexOf(rcpt.domain) !== -1) {
				mailboxes.push({
					user: sender,
					folder: '.Junk',
					path: path.join(rcpt.mailDir, (res.get('queue/spamd').spam ? '.Junk' : ''))
				});
			}

		});

		// store the messages to the mailboxes
		async.each(mailboxes, function(mailbox, cb) {

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

		}, function mailboxesProcessed(err) {

			if (err) return onError(err);
			if (!answered) res.accept();

		});

	}
}
module.exports = {
	description: 'stores the message in the maildir format',
	author: 'Thomas Zilz',
	after: ['spamd'],
	handler: async (req, res) => {
		
		try {

			// module dependencies
			let fs = require('fs');
			let path = require('path');
			let uuid = require('node-uuid');
			let SMTPUtil = require('../../src/smtp-util');

			// a list of sender addresses (after extending them)
			let senders = [];

			// a list of recipient mail (after extending them)
			let recipients = [];
			
			// a list of mailboxes
			let mailboxes = [];

			// extend function, either from the config or a simple placeholder
			let extend = typeof(req.config.extend) === 'function' ? req.config.extend : (address) => {
				return [address];
			}
			
			// only store mails for senders that belong to our domain
			if (req.session.config.domains.indexOf(req.session.envelope.from.split('@')[1]) !== -1) {
				let extended = await extend(req.session.envelope.from);
				if (extended) senders = senders.concat(extended);
			}
			
			// only store mails for recipients that belong to our domain
			for (let recipient of req.session.envelope.to) {
				if (req.session.config.domains.indexOf(recipient.split('@')[1]) === -1) continue;
				let extended = await extend(recipient);
				if (extended) recipients = recipients.concat(extended);
			}
			
			// add mailbox entries for senders
			senders.forEach((address) => {
				mailboxes.push({
					mailDir: req.config.mailDir.replace(/%n/g, address.split('@')[0]).replace(/%d/g, address.split('@')[1]),
					folder: '.Sent'
				});
			});

			// add mailbox entries for recipients
			recipients.forEach((address) => {
				mailboxes.push({
					mailDir: req.config.mailDir.replace(/%n/g, address.split('@')[0]).replace(/%d/g, address.split('@')[1]),
					folder: res.get('queue/spamd').spam ? '.Junk' : ''
				});
			});
			
			// write message to the designated mailboxes
			for (let mailbox of mailboxes) {

				// configure mailbox path
				mailbox.path = path.join(mailbox.mailDir, mailbox.folder);
				res.log.verbose('Storing mail to ' + mailbox.path);

				// create mail dirs if they do not exist yet
				let dirs = ['tmp', 'new', 'cur'];

				// create target directories if they do not yet exist
				for (let dir of dirs) await SMTPUtil.mkdirp(path.join(mailbox.path, dir));
				
				// stream the message to the file
				await new Promise((resolve, reject) => {
					
					// file names for different targets
					let filename = new Date().getTime() + '.' + uuid.v1() + '.' + req.session.config.hostname;
					let tmpFile = path.join(mailbox.path, 'tmp', filename);
					let finalFile = path.join(mailbox.path, 'new', filename);

					// a reference to source mail
					let message = fs.createReadStream(req.command.data);

					// try to catch errors (e.g. we cannot read the message)
					message.once('error', reject);

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
					fileStream.once('error', reject);

					// stream the message to the tmp folder
					message.pipe(fileStream);

					// once the file has been written completely,
					// copy it from the tmp folder to the new folder
					fileStream.once('finish', () => {

						fs.link(tmpFile, finalFile, (err) => {

							if (err) return reject('Failed to move message from "' + tmpFile + '" to "' + finalFile + '": ' + err);

							// delete the message from tmp
							fs.unlink(tmpFile, (err) => {

								return err ? reject('Failed to delete tmp message "' + tmpFile + '": ' + err) : resolve();

							});

						});

					});
					
				});
				
			}
			
			// accept
			res.accept(250, 'OK');

		} catch (ex) {
			
			// log the error and reject
			res.log.error('Error while storing message:', err);
			res.reject(451, 'Requested action aborted - failed to store message.');
			
		}
		
	}
	
}
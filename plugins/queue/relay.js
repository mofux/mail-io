module.exports = {

	description: 'triggers the "relay" event for every recipient, it\'s up to the user to decide if the message should be relayed',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// module dependencies
		var fs = require('fs');
		var async = require('async');

		// is the relay feature enabled?
		if (!req.config.enabled) return res.accept();

		// do we require authentication before we can relay
		if (!req.config.unauthenticated && !req.session.accepted.auth) return res.accept();

		// do we relay for senders that do not belong to our served domains?
		if (!req.config.open && req.session.config.domains.indexOf(req.session.envelope.from.split('@')[1]) === -1) return res.accept();

		// relay to recipients that are not local
		async.each(req.session.envelope.to, function(to, cb) {

			var local = req.session.config.domains.indexOf(to.split('@')[1]) !== -1;
			if (!local) {
				res.log.verbose('relaying mail to "' + to + '". local domains: ' + req.session.config.domains.join(', '));
				req.session.relay.add({ from: req.session.envelope.from, to: to }, fs.createReadStream(req.command.data), cb);
			} else {
				cb();
			}

		}, function(err) {

			if (err) res.log.error('failed to submit message to relay queue: ', err);

			// accept
			return res.accept();

		});

	}

}
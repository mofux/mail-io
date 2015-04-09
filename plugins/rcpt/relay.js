module.exports = {

	description: 'checks if the mail has to be relayed',
	author: 'Thomas Zilz',
	requires: [],
	handler: function(req, res) {

		// get the configuration of the queue/relay plugin
		var config = req.session.config.plugins && req.session.config.plugins['queue/relay'] ? req.session.config.plugins['queue/relay'] : null;

		// if there is no relay configuration, continue as normal
		if (!config) return res.accept();

		// check if the relaying feature is enabled
		if (!config.enabled) return res.accept();

		// with the relay enabled, check if the mail needs to be relayed
		var fromLocal = req.session.config.domains.indexOf(req.session.envelope.from.split('@')[1]) !== -1;
		var toLocal = req.session.config.domains.indexOf(req.to.split('@')[1]) !== -1;

		if (!toLocal) {

			// message has to be relayed to the foreign recipient
			// make sure a user is authenticated before allowing relay access
			if (!config.unauthenticated && !req.session.accepted.auth) return res.reject(502, 'relay access denied');

			// if the sender is not local and we are not an open relay, complain
			if (!config.open && !fromLocal) return res.reject(502, 'relay access denied');

		} else if (fromLocal && toLocal && !config.unauthenticated && !req.session.accepted.auth) {

			// do not allow mail relay between local users if no user is authenticated
			return res.reject(502, 'relay access denied');

		}

		// if we made it until here it is safe to accept
		res.accept();

	}

}
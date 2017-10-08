module.exports = {

	description: 'checks if the mail has to be relayed',
	author: 'Thomas Zilz',
	after: ['dnsbl'],
	handler: function(req, res) {

		// get the configuration of the queue/relay plugin
		let config = req.session.config.relay || null;

		// if there is no relay configuration or the relaying feature was not enabled, continue as normal
		if (!config) return res.accept();

		// check if the relaying feature is enabled
		if (!config.enabled) return res.accept();

		// with the relay enabled, check if the mail needs to be relayed
		let fromLocal = req.session.config.domains.indexOf(req.session.envelope.from.split('@')[1]) !== -1;
		let toLocal = req.session.config.domains.indexOf(req.to.split('@')[1]) !== -1;

		if (!toLocal) {

			// message has to be relayed to the foreign recipient
			// make sure a user is authenticated before allowing relay access
			if (!config.allowUnauthenticated && !req.session.accepted.auth) return res.reject(502, 'relay access denied');

			// if the sender is not local and we are not an open relay, complain
			if (!config.openRelay && !fromLocal) return res.reject(502, 'relay access denied');

		} else if (fromLocal && toLocal && !config.allowUnauthenticated && !req.session.accepted.auth) {

			// do not allow mail relay between local users if no user is authenticated
			return res.reject(502, 'relay access denied');

		}

		// if we made it until here it is safe to accept
		res.accept();

	}

}
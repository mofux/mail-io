module.exports = {

	description: 'triggers the "relay" event for every recipient, it\'s up to the user to decide if the message should be relayed',
	author: 'Thomas Zilz',
	after: ['core'],
	handler: async(req, res) => {

		// module dependencies
		const fs = require('fs');
		const config = req.session.config.relay || null;

		// is the relay feature enabled?
		if (!config || !config.enabled) return res.accept();

		// do we require authentication before we can relay
		if (!config.allowUnauthenticated && !req.session.accepted.auth) return res.accept();

		// do we relay for senders that do not belong to our served domains?
		if (!config.openRelay && req.session.config.domains.indexOf(req.session.envelope.from.split('@')[1]) === -1) return res.accept();

		// relay to recipients that are not local
		for (let to of req.session.envelope.to) {

			// check if the domain is a domain served by us
			let local = req.session.config.domains.includes(String(to.split('@')[1]).toLowerCase());
			
			// domain is not local, relay to it
			if (!local) {
				
				// relay it
				res.log.verbose(`Relaying mail to "${to}". Local domains: ${req.session.config.domains.join(', ')}`);
				await req.session.relay.add({ from: req.session.envelope.from, to: to }, fs.createReadStream(req.file), req.mail.headers).catch((err) => {
					
					// error adding the mail to the relay
					res.log.error('Failed to submit message to relay queue: ', err);
					
				});
				
			}
			
		}
		
		// accept anyway
		return res.accept();

	}

}
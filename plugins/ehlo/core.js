module.exports = {

	description: 'core implementation for EHLO command',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// TODO: implement proper EHLO checks
		if (req.command && req.command.data && req.command.data.length) {

			// reset the session, EHLO is essentially the same as RSET
			req.session.reset();

			// write the hostname
			res.write('250-' + req.session.config.hostname);

			// write out the supported features
			var features = [].concat(req.config.features);

			// remove the STARTTLS feature if the session is already secure
			if (req.session.secure && features.indexOf('STARTTLS') !== -1) {
				features.splice(features.indexOf('STARTTLS'), 1);
			}

			// write out the features
			while (features.length > 1) {
				res.write('250-' + features[0]);
				features.shift();
			}

			// write the last command as accept message
			res.accept(250, features[0] || 'OK');

		} else {

			// bad hostname, reject it
			res.reject(501, 'syntax: EHLO hostname');

		}

	}
}
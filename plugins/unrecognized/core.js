module.exports = {

	description: 'core implementation to handle unrecognized commands',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// increase the counter for unrecognized commands
		req.session.counters.unrecognizedCommands++;

		// disconnect the session if too many unrecognized commands were sent,
		// otherwise send back a reject message
		if (req.session.counters.unrecognizedCommands > req.session.config.limits.unrecognizedCommands) {
			res.end(554, 'error: too many unrecognized commands');
		} else {
			res.reject(502, 'command not recognized');
		}

	}

}
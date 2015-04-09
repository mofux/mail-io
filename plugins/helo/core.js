module.exports = {

	description: 'core implementation for HELO command',
	author: 'Thomas Zilz',
	requires: [],
	handler: function(req, res) {

		// TODO: implement proper HELO checks
		if (req.command && req.command.data && req.command.data.length) {
			req.session.reset();
			res.accept(250, req.session.config.hostname);
		} else {
			res.reject(501, 'syntax: HELO hostname');
		}

	}
}
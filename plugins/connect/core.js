module.exports = {

	description: 'core implementation for "connect" event',
	author: 'Thomas Zilz',
	requires: [],
	handler: function(req, res) {

		// make sure we do not exceed the maximum client connection count
		req.session.connection.server.getConnections(function(err, count) {

			if (err || count > req.session.config.limits.maxConnections) {

				// error or connection count exceeded, reject the client
				res.end(421, req.session.config.hostname + ' too many connected clients, try again in a moment');

			} else {

				// accept and greet with the hostname
				res.accept(220, req.session.config.hostname);

			}

		});

	}

}
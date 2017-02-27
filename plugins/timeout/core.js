module.exports = {

	description: 'core implementation for "timeout" event',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// end the client connection
		res.end(451, 'idle timeout (' + (req.session.config.limits.idleTimeout / 1000) + 's) expired - closing connection');

	}

}

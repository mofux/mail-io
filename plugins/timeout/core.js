module.exports = {

	description: 'core implementation for "timeout" event',
	author: 'Thomas Zilz',
	requires: [],
	handler: function(req, res) {

		// end the client connection
		res.end(451, 'idle timeout expired - closing connection');

	}

}
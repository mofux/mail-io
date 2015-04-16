module.exports = {

	description: 'core implementation for RSET command',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		req.session.reset();
		res.accept(250, 'OK');

	}

}
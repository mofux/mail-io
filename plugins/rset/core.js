module.exports = {

	description: 'core implementation for RSET command',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// reset the current transaction
		req.session.resetTransaction();
		res.accept(250, 'OK');

	}

}

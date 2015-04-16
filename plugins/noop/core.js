module.exports = {

	description: 'core implementation for NOOP command',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		res.accept(250, 'OK');

	}

}
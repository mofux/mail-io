module.exports = {

	description: 'core implementation for HELP command',
	author: 'Thomas Zilz',
	requires: [],
	handler: function(req, res) {

		res.accept(214, 'see https://tools.ietf.org/html/rfc5321 for details')

	}
}
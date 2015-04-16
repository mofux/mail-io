module.exports = {

	description: 'core implementation for the "queue" event',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// for easier handling, assign the file to the req
		req.file = req.command.data;

		// accept
		res.accept();

	}

}
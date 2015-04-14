module.exports = {

	author: 'Thomas Zilz',
	description: 'adds support for AUTH PLAIN and AUTH LOGIN',
	requires: [],
  handler: function(req, res) {

		// module dependencies
		var _ = require('lodash');

		// after an AUTH command has been successfully completed, no more AUTH commands may be issued in the same session
		// after a successful AUTH command completes, a server MUST reject any further AUTH commands with a 503 reply.
		if (req.session.accepted.auth) return res.reject(503, 'already authenticated');

		// the AUTH command is not permitted during a mail transaction. an AUTH command issued during a mail transaction MUST be rejected with a 503 reply.
		if (req.session.accepted.mail) return res.reject(503, 'not permitted');

		// make sure proper auth data was sent
		if (!req.command.data) return res.reject(501, 'bad syntax');

		// check the auth type (LOGIN or PLAIN)
		var type = req.command.data.split(' ')[0];

		// make sure the type is valid
		if (!_.isString(type) || !type.length) return res.reject(501, 'bad syntax');

		// ignore the case
		type = type.toLowerCase();

		// process the supported authentication types
		switch(type) {

			// AUTH PLAIN
			case 'plain':

				if (req.command.data.split(' ').length !== 2) return res.reject(501, 'bad syntax');

				// plain auth sends one base64 encoded string that contains the username and the password (e.g. user\x00user\x00password);
				var data = new Buffer(req.command.data.split(' ')[1], 'base64').toString().split('\x00');
				if (data.length < 2) return res.reject(500, 'invalid user data');

				// get the user and password
				var username = data.length < 3 ? data[0] : data[1];
				var password = data.length < 3 ? data[1] : data[2];

				// make sure username and password are set
				if (!username || !username.length || !password || !password.length) return res.reject(500, 'invalid user data');

				// assign the user to the session
				req.user = {
					username: username,
					password: password
				}

				// special handling: the server can send messages to us that have to be implicitly authenticated.
				// to do this, it provides a apiUser object that it uses to authenticate. The apiUser object's
				// username and password are random strings generated with every server start.
				// if the username and password match this apiUser, we will not continue processing the auth
				// handlers as they should not care about this implementation detail
				if (req.session.connection.server.apiUser && req.session.connection.server.apiUser.username === username && req.session.connection.server.apiUser.password === password) {
					res.log.verbose('authentication succeeded using the api user. no more auth handlers will be called');
					return res.final(235, 'authentication successful (api user)');
				}

				// accept the request
				// note: the following 'auth' listeners should check
				// for req.user and verify if the username and password
				// are valid. if they are not valid, they must call res.reject(535, 'authentication failed')
				res.accept(235, 'authentication successful');
				return;

			// AUTH LOGIN
			case 'login':

				// request the username
				res.write('334 ' + new Buffer('Username:', 'utf8').toString('base64'));

				// listen for the username to arrive
				res.read(function(data) {

					// the auth request can be cancelled with a single '*'
					if (data.toString().replace(/\r?\n|\r/g, '') === '*') {
						return res.reject(501, 'authentication aborted');
					}

					// this should now have the decoded username
					var username = new Buffer(data.toString(), 'base64').toString();

					// request the password
					res.write('334 ' + new Buffer('Password:', 'utf8').toString('base64'));

					// listen for the password to arrive
					res.read(function(data) {

						// the auth request can be cancelled with a single '*'
						if (data.toString().replace(/\r?\n|\r/g, '') === '*') {
							return res.reject(501, 'authentication aborted');
						}

						// this should now have the decoded password
						var password = new Buffer(data.toString(), 'base64').toString();

						// assign the user to the session
						req.user = {
							username: username,
							password: password
						}

						// accept the request
						// note: the following 'auth' listeners should check
						// for req.user and verify if the username and password
						// are valid. if they are not valid, they must call res.reject(535, 'authentication failed')
						res.accept(235, 'authentication successful');

					});
				});
				return;

			default:
				// reject any unknown auth methods
				return res.reject(501, 'bad syntax');

		}

	}
}
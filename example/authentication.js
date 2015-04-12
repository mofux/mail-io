var mailer = require('./../lib/server.js');
var async = require('async');

var server = mailer.createServer({
	listen: {
		smtp: false,
		smtps: false,
		smtptls: 25
	}
}, function(session) {

	session.on('auth', function(req, res) {

		// make sure tester/tester (dGVzdGVy) gets through
		if (req.user && req.user.username === 'tester' && req.user.password === 'tester') {
			res.accept();
		} else {
			res.reject(552, 'authentication failed');
		}

	});

});

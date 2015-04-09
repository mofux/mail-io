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

		// make sure thomas/thomas (dGhvbWFz) gets through
		if (req.user && req.user.username === 'thomas' && req.user.password === 'thomas') {
			res.accept();
		} else {
			res.reject(552, 'authentication failed');
		}

	});

});

var smtp = require('smtp-protocol');

smtp.connect('localhost', 25, function(mail) {
	async.series([
		function(cb) {
			mail.ehlo('localhost', cb);
		},
		function(cb) {
			mail.login('thomas', 'thomas', 'PLAIN', cb);
		},
		function(cb) {
			mail.from('thomas@vagrant-master', cb);
		},
		function(cb) {
			mail.to('t.zilz@mofux.org', cb);
		}, function(cb) {
			mail.data(cb);
		},
		function(cb) {
			require('fs').createReadStream('/vagrant/README.md').pipe(mail.message(cb));
		},
		function(cb) {
			mail.quit(cb);
		}
	], function(err, data) {
		//console.log(err, data);
	});
});

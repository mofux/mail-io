var mailer = require('./../lib/server.js');
var async = require('async');

var server = mailer.createServer({
	listen: {
		smtp: false,
		smtps: false,
		smtptls: 25
	},
	domains: ['test.com']
}, function(session) {

	session.on('auth', function(req, res) {

		// make sure thomas/thomas (dGhvbWFz) gets through
		if (req.user && req.user.username === 'thomas' && req.user.password === 'thomas') {
			res.accept();
		} else {
			res.reject(552, 'authentication failed');
		}

	});

	// make sure mails are only received for local users
	// and is only relayed from local users that are authenticated
	session.on('rcpt', function(req, res) {

		// some imaginary domain name that belongs to us
		var domains = req.session.config.domains;

		// check if from or to address belongs to our domain
		var fromLocal = domains.indexOf(req.session.envelope.from.split('@')[1]) !== -1;
		var toLocal = domains.indexOf(req.to.split('@')[1]) !== -1;

		// if the message is not sent from a local address or to a
		// local address, reject it
		if (!fromLocal && !toLocal) return res.reject(502, 'relay access denied');

		// if the message is sent from our domain,
		// require the user to be authenticated
		if (fromLocal && !toLocal && !req.session.accepted.auth) {
			return res.reject(502, 'relay access denied');
		}

		// accept the recipient
		res.accept(250, 'OK');

	});

	// relay the message if the recipient is not local
	session.on('queue', function(req, res) {

		// some imaginary domain name that belongs to us
		var domains = req.session.config.domains;

		req.session.envelope.to.forEach(function(to) {

			var toLocal = domains.indexOf(req.to.split('@')[1]) !== -1;

			// relay mails for non local recipients
			if (!toLocal) {
				res.log.info('relaying to non-local recipient "' + to + '"');
				res.relay(to);
			}

		});

		return res.accept();

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
			mail.from('t.zilz@mofux.org', cb);
		},
		function(cb) {
			mail.to('martin@test.com', cb);
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
		console.log(err, data);
	});
});

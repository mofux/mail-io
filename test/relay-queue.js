/**
 * ABOUT THIS TEST:
 * -------------------------------
 * This test will create two server instances, one for the domain "localhost"
 * and the other for the domain "remote". Goal of the test is to
 * connect via client to the instance hosting "remote" and sending a
 * message from "user@remote" to "user@localhost" and "admin@localhost".
 * This will cause the "remote" server to relay the message to "localhost" twice.
 * To confirm this is working, we are listening for the "queue" event on "localhost",
 * which should be triggered if "remote" successfully relayed the message to "localhost"
 */
module.exports = function() {

	var should = require('should');
	var mailer = require('../lib/server.js');
	var net = require('net');
	var tls = require('tls');
	var fs = require('fs');
	var colors = require('colors/safe');
	var localhost = null;
	var remote = null;

// enable debug output
	var debug = false;

// function will be overwritten by our test.
// function is called when the 'queue' event is triggered on localhost
	var onLocalhostQueue = null;
	var failed = 0;

	// create "localhost" domain server
	mailer.createServer({
		listen: {
			smtp: 2328,
			smtps: false,
			smtptls: false
		},
		logger: {
			verbose: function() {
				debug ? console.log(colors.bgYellow(' LOCAL ') + ' ' + arguments[0]) : function(){};
			}
		},
		domains: ['localhost']
	}, function(session) {
		localhost = session;
		session.on('queue', onLocalhostQueue);

		session.on('rcpt', function(req, res) {
			// reject on the first try
			if (failed >= 1) {
				return res.accept();
			} else {
				failed++;
				return res.reject(431, 'temporary error message');
			}
		});
	});

	// create "remote" domain server
	mailer.createServer({
		listen: {
			smtp: 2329,
			smtps: false,
			smtptls: false
		},
		logger: {
			verbose: function() {
				debug ? console.log(colors.bgWhite(' REMOT ') + ' ' + arguments[0]) : function(){};
			}
		},
		relay: {
			smtpPort: 2328,
			retryBaseInterval: 1
		},
		domains: ['remote']
	}, function(session) {
		remote = session;
	});

	describe('relay queue test', function() {

		this.timeout('20000');

		var client = net.connect({ host: 'localhost', port: 2329 });

		it('should connect', function(done) {
			client.once('data', function(res) {
				res.toString().should.startWith('220');
				done();
			});
		});

		it('should relay mail to user@localhost and admin@localhost', function(done) {

			var message = 'Hello user@localhost, how are you?';

			client.write('EHLO client\r\n');
			client.write('AUTH PLAIN dXNlcgB1c2VyAHBhc3N3b3Jk\r\n');
			client.write('MAIL FROM: user@remote\r\n');
			client.write('RCPT TO: user@localhost\r\n');
			client.write('RCPT TO: admin@localhost\r\n');
			client.write('DATA\r\n');
			client.write(message + '\r\n.\r\n');

			// hook to 'queue' listener on localhost
			onLocalhostQueue = function(req, res) {
				localhost.accepted.data.should.be.ok;
				localhost.envelope.from.should.equal('user@remote');
				localhost.envelope.to[0].should.equal('user@localhost');
				fs.readFileSync(req.command.data).toString().should.equal(message);
				res.accept();

				// hook to 'queue' listener on localhost
				onLocalhostQueue = function(req, res) {
					localhost.accepted.data.should.be.ok;
					localhost.envelope.from.should.equal('user@remote');
					localhost.envelope.to[0].should.equal('admin@localhost');
					fs.readFileSync(req.command.data).toString().should.equal(message);
					res.accept();
					done();
				}
			}

		});

	});

}()

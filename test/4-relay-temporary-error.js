/**
 * ABOUT THIS TEST:
 * -------------------------------
 * This test will create two server instances, one for the domain "localhost"
 * and the other for the domain "remote". Goal of the test is to
 * connect via client to the instance hosting "remote" and sending a
 * message from "user@remote" to "user@localhost" and "admin@localhost".
 * This will cause the "remote" server to relay the message to "localhost" twice.
 * To confirm this is working, we are listening for the "queue" event on "localhost",
 * which should be triggered if "remote" successfully relayed the message to "localhost".
 * Additionally, we will trigger a temporary error message on the "localhost" server
 * for the first rcpt command arriving, which should cause the relay to retry the
 * delivery
 */
module.exports = function() {

	let should = require('should');
	let SMTPServer = require('../src/smtp-server');
	let net = require('net');
	let tls = require('tls');
	let fs = require('fs');
	let path = require('path');
	let os = require('os');
	let colors = require('colors/safe');
	let localhost = null;
	let remote = null;

	// enable debug output
	let debug = true;
	let config = {};

	// generate config
	['localhost', 'remote'].forEach((c) => {
		config[c] = {
			domains: [c],
			logger: {},
			relay: {
				queueDir: path.join(os.tmpdir(), `mail-io-queue-test-${c}-${Date.now()}`),
				smtpPort: c === 'remote' ? 2328 : 25,
				retryBaseInterval: 1
			}
		};
		['debug', 'verbose', 'info', 'protocol', 'error', 'warn'].forEach((l) => {
			config[c].logger[l] = (...args) => {
				if (typeof args[0] !== 'string') console.log(args[0]);
				console.log(colors.bgCyan(colors.white(` ${c.toUpperCase().slice(0, 5)} `)) + args[0]);
			}
		});
	});

	// function will be overwritten by our test.
	// function is called when the 'queue' event is triggered on localhost
	let onLocalhostQueue = null;
	let failed = 0;

	// create "localhost" domain server
	new SMTPServer(config.localhost, (session) => {
		localhost = session;
		session.on('queue', onLocalhostQueue);
		session.on('rcpt', (req, res) => {
			// reject on the first try
			if (failed >= 1) {
				return res.accept();
			} else {
				failed++;
				return res.reject(431, 'temporary error message');
			}
		});
	}).listen(2328);

	// create "remote" domain server
	new SMTPServer(config.remote, (session) => {
		remote = session
	}).listen(2329);
	
	describe('relay temporary failure test', function() {

		this.timeout('20000');

		let client = net.connect({ host: 'localhost', port: 2329 });

		it('should connect', (done) => {
			client.once('data', (res) => {
				res.toString().should.startWith('220');
				done();
			});
		});

		it('should relay mail to user@localhost and admin@localhost', (done) => {

			let message = 'Hello user@localhost, how are you?';

			client.write('EHLO client\r\n');
			client.write('AUTH PLAIN dXNlcgB1c2VyAHBhc3N3b3Jk\r\n');
			client.write('MAIL FROM: user@remote\r\n');
			client.write('RCPT TO: user@localhost\r\n');
			client.write('RCPT TO: admin@localhost\r\n');
			client.write('DATA\r\n');
			client.write(message + '\r\n.\r\n');

			let users = ['admin@localhost', 'user@localhost'];

			// hook to 'queue' listener on localhost
			onLocalhostQueue = (req, res) => {
				localhost.accepted.data.should.be.ok;
				localhost.envelope.from.should.equal('user@remote');
				localhost.envelope.to[0].should.endWith('@localhost');
				users.splice(users.indexOf(localhost.envelope.to[0]), 1);
				fs.readFileSync(req.command.data).toString().trim().should.endWith(message);
				res.accept();

				// hook to 'queue' listener on localhost
				onLocalhostQueue = (req, res) => {
					localhost.accepted.data.should.be.ok;
					localhost.envelope.from.should.equal('user@remote');
					localhost.envelope.to[0].should.equal(users[0]);
					fs.readFileSync(req.command.data).toString().trim().should.endWith(message);
					res.accept();
					done();
				}
			}

		});

	});

}()

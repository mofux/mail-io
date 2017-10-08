/**
 * ABOUT THIS TEST:
 * -------------------------------
 * This test will create two servers, localhost and remote
 * and then we will try to send an email from remote to 
 * two recipients at localhost
 */
module.exports = function () {

	let should = require('should');
	let SMTPServer = require('../src/smtp-server');
	let net = require('net');
	let tls = require('tls');
	let fs = require('fs');
	let path = require('path');
	let os = require('os');
	let colors = require('colors/safe');

	// enable debug output
	let debug = true;
	let config = {};

	// generate config
	['localhost', 'remote'].forEach((c) => {
		config[c] = {
			domains: [c],
			logger: {},
			throwOnError: true,
			relay: {
				queueDir: path.join(os.tmpdir(), `mail-io-queue-test-${c}-${Date.now()}`),
				smtpPort: c === 'remote' ? 2333 : 25,
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
	let localhost = new SMTPServer(config.localhost, (session) => {
		session.on('queue', onLocalhostQueue);
	}).listen(2333);

	// create "remote" domain server
	let remote = new SMTPServer(config.remote).listen(2332);

	describe('api send mail from remote to localhost', function () {
		
		this.timeout(10000);

		it('should send the mail via api', () => {

			return remote.sendMail({
				from: 'user@remote',
				to: ['user@localhost', 'user2@localhost'],
				subject: 'Test',
				html: '<h1>Hello from remote</h1>'
			});
			
		});
		
		let cqueue = [];
		
		it('should receive two messages', (done) => {
			
			let received = [];
			onLocalhostQueue = function(req, res) {
				should(received.indexOf(req.session.envelope.to)).equal(-1);
				received = received.concat(req.session.envelope.to);
				should(req.session.envelope.from).equal('user@remote');
				should(req.session.envelope.to.length).equal(1);
				localhost.getConnections((err, count) => {
					res.accept();
					should(count).equal(2);
					if (received.length === 2) return done(err);
				});
				
			}
			
		});
		
		it('should have no connections', (done) => {
			
			localhost.getConnections((err, count) => {
				should(count).equal(0);
				remote.getConnections((err, count) => {
					should(count).equal(0);
					done();
				});
			});
			
		});

	});

}()

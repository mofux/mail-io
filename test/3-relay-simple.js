/**
 * ABOUT THIS TEST:
 * -------------------------------
 * This test will create two server instances, one for the domain "localhost"
 * and the other for the domain "remote". Goal of the test is to
 * connect via client to the instance hosting "remote" and sending a
 * message from "user@remote" to "user@localhost".
 * This will cause the "remote" server to relay the message to "localhost".
 * To confirm this is working, we are listening for the "queue" event on "localhost",
 * which should be triggered if "remote" successfully relayed the message to "localhost"
 */
module.exports = function() {

	let should = require('should');
	let net = require('net');
	let tls = require('tls');
	let fs = require('fs');
	let path = require('path');
	let os = require('os');
	let colors = require('colors/safe');
	let SMTPServer = require('../src/smtp-server.js');

	// enable debug output
	let debug = true;
	let config = {};
	
	// generate config
	['localhost', 'remote'].forEach((c) => {
		config[c] = { 
			domains: [c], 
			logger: {}, 
			relay: { 
				queueDir: path.join(os.tmpdir(), `mail-io-queue-test-${c}-${Date.now()}`) , 
				smtpPort: c === 'remote' ? 2323 : 25 
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

	// create "localhost" domain server
	let localhost = new SMTPServer(config.localhost, (session) => {
		localhost = session;
		session.on('queue', onLocalhostQueue);
	}).listen(2323);

	// create "remote" domain server
	let remote = new SMTPServer(config.remote, (session) => {
		remote = session
	}).listen(2324);

	describe('simple relay test', function() {

		this.timeout('10000');

		let client = net.connect({ host: 'localhost', port: 2324 });

		it('should connect', function(done) {
			client.once('data', function(res) {
				res.toString().should.startWith('220');
				done();
			});
		});

		it('should relay mail to user@localhost', (done) => {

			let message = 'Hello user@localhost, how are you?';

			client.write('EHLO client\r\n');
			client.write('AUTH PLAIN dXNlcgB1c2VyAHBhc3N3b3Jk\r\n');
			client.write('MAIL FROM: user@remote\r\n');
			client.write('RCPT TO: user@localhost\r\n');
			client.write('DATA\r\n');
			client.write(message + '\r\n.\r\n');

			// hook to 'queue' listener on localhost
			onLocalhostQueue = (req, res) => {
				localhost.accepted.data.should.be.ok;
				localhost.envelope.from.should.equal('user@remote');
				localhost.envelope.to[0].should.equal('user@localhost');
				fs.readFileSync(req.command.data).toString().trim().should.endWith(message);
				res.accept();
				done();
			}

		});

	});

}()

module.exports = function() {

	const should = require('should');
	const net = require('net');
	const tls = require('tls');
	const fs = require('fs');
	const path = require('path');
	const SMTPServer = require('../src/smtp-server');

	// set to true to enable debug output
	const debug = true;

	// temporary data
	const data = {};

	// handlers used for both server types
	const handlers = {
		'auth': [{
			name: 'auth-test',
			after: ['core'],
			handler: (req, res) => {
				data.user = req.user;
				if (req.user.username !== 'user' || req.user.password !== 'password') return res.reject(535, 'authentication failed');
				res.accept();
			}
		}],
		'queue': [{
			name: 'queue-test',
			after: ['core'],
			handler: (req, res) => {
				data.mail = req.mail;
				res.accept();
			}
		}]
	}

	let server, smtp;

	describe('server tests', function() {

		this.timeout(1000);
		
		it('should initialize server', (done) => {
			
			server = new SMTPServer({
				logger: {
					verbose: debug ? console.log : () => {}
				},
				domains: ['localhost'],
				handlers: handlers
			}, (session) => {
				data.session = session;
			});
			
			should(server.port).equal(null);
			
			server.listen(2625, (err) => {
				should(server.port).equal(2625);
				should(server.config).be.ok;	
				done(err);
			});
			
		});

		it('should greet on smtp', (done) => {
			
			smtp = net.connect({ port: 2625 }, (err) => {
				smtp.once('data', (data) => {
					data.toString().should.startWith('220 ');
					done();
				});
			});
			
		});
		
		it('should have one server connection', (done) => {
			server.getConnections((err, count) => {
				should(err).not.be.ok;
				should(count).equal(1);
				done(err);
			});
		});

		it('should reject empty command', (done) => {
			smtp.write('\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('502 ');
				done();
			});
		});

		it('should reject unknown commands', (done) => {
			smtp.write('UNKOWN COMMAND\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('502 ');
				done();
			});
		});

		it('should start login authentication', (done) => {
			smtp.write('AUTH LOGIN\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('334');
				done();
			});
		});

		it('should accept login user', (done) => {
			smtp.write(new Buffer('user').toString('base64') + '\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('334');
				done();
			});
		});

		it('should accept login password', (done) => {
			smtp.write(new Buffer('password').toString('base64') + '\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('235');
				done();
			});
		});

		it('should provide valid req.user to auth login handler', (done) => {
			data.user.should.be.type('object');
			data.user.username.should.equal('user');
			data.user.password.should.equal('password');
			done();
		});

		it('should reject a second auth', (done) => {
			smtp.write('AUTH PLAIN\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('503');
				done();
			});
		});

		it('should provide valid req.user to auth plain handler', (done) => {
			data.user.should.be.type('object');
			data.user.username.should.equal('user');
			data.user.password.should.equal('password');
			done();
		});

		it('should reject mail before helo', (done) => {
			smtp.write('MAIL FROM: <admin>\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('503 ');
				done();
			});
		});

		it('should reject rcpt before mail', (done) => {
			smtp.write('RCPT TO: <admin>\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('503 ');
				done();
			});
		});

		it('should reject data before rcpt', (done) => {
			smtp.write('DATA\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('503 ');
				done();
			});
		});

		it('should reject empty helo', (done) => {
			smtp.write('HELO\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('501 ');
				done();
			});
		});

		it('should accept helo with hostname', (done) => {
			smtp.write('HELO localhost\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('250 ');
				done();
			});
		});

		it('should list STARTTLS on ehlo for unsecure connections', (done) => {
			smtp.write('EHLO localhost\r\n');
			let foundSTARTTLS = false;
			let check = (data) => {
				data.toString().should.startWith('250');
				if (data.toString().indexOf('STARTTLS') !== -1) foundSTARTTLS = true;
				if (data.toString().indexOf('250 ') !== -1) {
					foundSTARTTLS.should.be.ok;
					done();
				} else {
					smtp.once('data', check);
				}
			}
			smtp.once('data', check);
		});

		it('should upgrade the connection on STARTTLS', (done) => {
			smtp.write('STARTTLS\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('220');
				let ctx = tls.createSecureContext(data.session.config.tls);
				let pair = tls.createSecurePair(ctx, false, true, false);
				pair.encrypted.pipe(smtp).pipe(pair.encrypted);
				pair.once('secure', () => {
					pair.cleartext.write('EHLO localhost\r\n');
					let foundSTARTTLS = false;
					let check = (data) => {
						data.toString().should.startWith('250');
						if (data.toString().indexOf('STARTTLS') !== -1) foundSTARTTLS = true;
						if (data.toString().indexOf('250 ') !== -1) {
							foundSTARTTLS.should.not.be.ok;
							smtp = pair.cleartext;
							done();
						} else {
							pair.cleartext.once('data', check);
						}
					}
					pair.cleartext.once('data', check);
				});
			});
		});
		
		it('should have one server connection after STARTTLS', (done) => {
			server.getConnections((err, count) => {
				should(err).not.be.ok;
				should(count).equal(1);
				done(err);
			});
		});
		
		it('should retain session data after STARTTLS', (done) => {
			should(data.session.accepted.helo).be.ok;
			should(data.session.accepted.ehlo).be.ok;
			should(data.session.accepted.auth).be.ok;
			done();
		});

		it('should accept plain auth', (done) => {
			// clear last login
			delete data.session.user;
			delete data.session.accepted.auth;
			smtp.write('AUTH PLAIN ' + new Buffer('user\x00user\x00\password').toString('base64') + '\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('235');
				should(data.session.accepted.auth).be.ok;
				done();
			});
		});

		it('should reject empty mail', (done) => {
			smtp.write('MAIL\r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('501');
				done();
			});
		});

		it('should reject incomplete mail', (done) => {
			smtp.write('MAIL FROM: \r\n');
			smtp.once('data', (data) => {
				data.toString().should.startWith('501');
				done();
			});
		});

		it('should accept bounce mail (<>)', (done) => {
			smtp.write('MAIL FROM: <>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				should(data.session.envelope.from).be.ok;
				data.session.envelope.from.should.equal('<>');
				data.session.accepted.mail.should.be.ok;
				done();
			});
		});

		it('should not accept nested mail', (done) => {
			smtp.write('MAIL FROM: <>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('503');
				should(data.session.rejected.mail).be.ok;
				done();
			});
		});

		it('should accept mail without <>', (done) => {
			data.session.accepted.mail = false;
			data.session.envelope.from = null;
			smtp.write('MAIL FROM: test@localhost\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				data.session.envelope.from.should.equal('test@localhost');
				data.session.accepted.mail.should.be.ok;
				done();
			});
		});

		it('should reject empty rcpt', (done) => {
			smtp.write('RCPT\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('501');
				should(data.session.accepted.rcpt).not.be.ok;
				done();
			});
		});

		it('should reject incomplete rcpt', (done) => {
			smtp.write('RCPT TO: \r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('501');
				should(data.session.accepted.rcpt).not.be.ok;
				done();
			});
		});

		it('should accept rcpt without <>', (done) => {
			smtp.write('RCPT TO: test@localhost\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				data.session.envelope.to.indexOf('test@localhost').should.not.equal(-1);
				data.session.accepted.rcpt.should.be.ok;
				done();
			});
		});

		it('should accept additional rcpt', (done) => {
			smtp.write('RCPT TO: test2@localhost\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				data.session.envelope.to.indexOf('test2@localhost').should.not.equal(-1);
				data.session.envelope.to.length.should.equal(2);
				data.session.accepted.rcpt.should.be.ok;
				done();
			});
		});

		it('should not add duplicate recipients', (done) => {
			smtp.write('RCPT TO: test2@localhost\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				data.session.envelope.to.indexOf('test2@localhost').should.not.equal(-1);
				data.session.envelope.to.length.should.equal(2);
				done();
			});
		});

		it('should not relay unauthenticated for local sender and local recipient', (done) => {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@localhost';
			delete data.session.accepted.auth;
			delete data.session.rejected.auth;
			delete data.session.user;
			smtp.write('RCPT TO: <test2@localhost>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('502');
				done();
			});
		});

		it('should not relay unauthenticated for local sender and remote recipient', (done) => {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@localhost';
			delete data.session.accepted.auth;
			delete data.session.rejected.auth;
			delete data.session.user;
			smtp.write('RCPT TO: <test@remote>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('502');
				done();
			});
		});

		it('should relay unauthenticated for remote sender and local recipient', (done) => {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@remote';
			delete data.session.accepted.auth;
			delete data.session.rejected.auth;
			delete data.session.user;
			smtp.write('RCPT TO: <test@localhost>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('should relay authenticated for local sender and remote recipient', (done) => {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@localhost';
			data.session.accepted.auth = 235;
			data.session.user = { username: 'username', password: 'password' };
			delete data.session.rejected.auth;
			smtp.write('RCPT TO: <test@remote>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('should relay authenticated for local sender and local recipient', (done) => {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@localhost';
			data.session.accepted.auth = 235;
			data.session.user = { username: 'username', password: 'password' };
			delete data.session.rejected.auth;
			smtp.write('RCPT TO: <test@localhost>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('should not relay authenticated for remote sender and remote recipient', (done) => {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@remote';
			data.session.accepted.auth = 235;
			data.session.user = { username: 'username', password: 'password' };
			delete data.session.rejected.auth;
			smtp.write('RCPT TO: <test@remote>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('502');
				done();
			});
		});

		it('should relay authenticated for remote sender and local recipient', (done) => {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@remote';
			data.session.accepted.auth = 235;
			data.session.user = { username: 'username', password: 'password' };
			delete data.session.rejected.auth;
			smtp.write('RCPT TO: <test@localhost>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('should accept data', (done) => {
			smtp.write('DATA\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('354');
				done();
			});
		});

		it('should write gtube message', (done) => {
			let file = fs.createReadStream(__dirname + '/assets/gtube.msg');
			file.pipe(smtp, { end: false });
			file.once('end', () => {
				smtp.write('\r\n.\r\n');
				smtp.once('data', (res) => {
					res.toString().should.startWith('250');
					done();
				});
			});
		});

		it('should have increased the transaction id to 1', () => {
			data.session.transaction.should.equal(1);
		});

		it('should have reset the envelope', () => {
			should(data.session.accepted.mail).be.not.ok;
			should(data.session.accepted.rcpt).be.not.ok;
			should(data.session.accepted.data).be.not.ok;
			should(data.session.accepted.queue).be.not.ok;
		});

		it('should have a spamd score', () => {
			should(data.session.data.queue.spamd.score).be.type('number');
		});

		it('should have a parsed mail object', () => {
			should(data.mail).be.type('object');
			data.mail.from[0].address.should.equal('test@localhost');
			should(data.mail.headers).be.type('object');
		});

		it('should accept mail in second transaction', (done) => {
			smtp.write('MAIL FROM: <second@localhost>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				data.session.accepted
				done();
			});
		});

		it('should accept rcpt in second transaction', (done) => {
			smtp.write('RCPT TO: <second-rcpt@localhost>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('should accept data in second transaction', (done) => {
			smtp.write('DATA\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('354');
				done();
			});
		});

		it('should write gtube message in second transaction', (done) => {
			let file = fs.createReadStream(path.join(__dirname, 'assets' , 'gtube.msg'));
			file.pipe(smtp, { end: false });
			file.once('end', () => {
				smtp.write('\r\n.\r\n');
				smtp.once('data', (res) => {
					res.toString().should.startWith('250');
					done();
				});
			});
		});

		it('should have increased the transaction id to 2', () => {
			data.session.transaction.should.equal(2);
		});

		it('should accept mail in third transaction', (done) => {
			smtp.write('MAIL FROM: <third@localhost>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				data.session.accepted
				done();
			});
		});

		it('should accept rcpt in third transaction', (done) => {
			smtp.write('RCPT TO: <third-rcpt@localhost>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('should RSET the transaction', (done) => {
			smtp.write('RSET\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				should(data.session.user).be.ok;
				should(data.session.accepted.ehlo).be.ok;
				should(data.session.accepted.auth).be.ok;
				should(data.session.accepted.mail).be.not.ok;
				should(data.session.accepted.rcpt).be.not.ok;
				should(data.session.accepted.data).be.not.ok;
				should(data.session.accepted.queue).be.not.ok;
				done();
			});
		});

		it('should accept mail after RSET', (done) => {
			smtp.write('MAIL FROM: <third@localhost>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				data.session.accepted
				done();
			});
		});

		it('should accept rcpt after RSET', (done) => {
			smtp.write('RCPT TO: <third-rcpt@localhost>\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('smtp client should quit', (done) => {
			smtp.write('QUIT\r\n');
			smtp.once('data', (res) => {
				res.toString().should.startWith('221');
				done();
			});
		});

		it('should be disconnected', (done) => {
			data.session.connection.closed.should.be.true;
			done();
		});

		it('smtp server should have no open connections', (done) => {
			server.getConnections((err, count) => {
				if (err) return done(err);
				count.should.equal(0);
				done();
			});
		});

	});
	
}()

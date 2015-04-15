module.exports = function() {

	var should = require('should');
	var mailer = require('../lib/server.js');
	var net = require('net');
	var tls = require('tls');
	var fs = require('fs');

	// set to true to enable debug output
	var debug = true;

	// temporary data
	var data = {};

	// handlers used for both server types
	var handlers = {
		'auth': [{
			name: 'auth-test',
			requires: ['core'],
			handler:  function(req, res) {
				data.user = req.user;
				if (req.user.username !== 'user' || req.user.password !== 'password') return res.reject(535, 'authentication failed');
				res.accept();
			}
		}]
	}

	var smtpServer = mailer.createServer({
		port: 2625,
		logger: {
			verbose: debug ? console.log : function() {}
		},
		domains: ['localhost'],
		handlers: handlers
	}, function(session) {
		data.session = session;
	});

	var smtpsServer = mailer.createServer({
		port: 2626,
		secure: true,
		logger: {
			verbose: debug ? console.log : function() {}
		},
		domains: ['localhost'],
		handlers: handlers
	});



	describe('server tests', function() {

		this.timeout(10000);

		var smtps = tls.connect({port: 2626, rejectUnauthorized: false});
		var smtp = net.connect({port: 2625});

		it('should greet on smtp', function(done) {
			smtp.once('data', function(data) {
				data.toString().should.startWith('220 ');
				done();
			});
		});

		it('should greet on smtps', function(done) {
			smtps.once('data', function(data) {
				data.toString().should.startWith('220 ');
				done();
			});
		});

		it('should reject empty command', function(done) {
			smtp.write('\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('502 ');
				done();
			});
		});

		it('should reject unknown commands', function(done) {
			smtp.write('UNKOWN COMMAND\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('502 ');
				done();
			});
		});

		it('should start login authentication', function(done) {
			smtp.write('AUTH LOGIN\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('334');
				done();
			});
		});

		it('should accept login user', function(done) {
			smtp.write(new Buffer('user').toString('base64') + '\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('334');
				done();
			});
		});

		it('should accept login password', function(done) {
			smtp.write(new Buffer('password').toString('base64') + '\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('235');
				done();
			});
		});

		it('should provide valid req.user to auth login handler', function(done) {
			data.user.should.be.type('object');
			data.user.username.should.equal('user');
			data.user.password.should.equal('password');
			done();
		});

		it('should reject a second auth', function(done) {
			smtp.write('AUTH PLAIN\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('503');
				done();
			});
		});

		it('should reset the session', function(done) {
			smtp.write('RSET\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('250');
				should(data.session.user).not.be.ok;
				should(data.session.accepted.auth).not.be.ok;
				done();
			});
		});

		it('should provide valid req.user to auth plain handler', function(done) {
			data.user.should.be.type('object');
			data.user.username.should.equal('user');
			data.user.password.should.equal('password');
			done();
		});

		it('should reject mail before helo', function(done) {
			smtp.write('MAIL FROM: <admin>\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('503 ');
				done();
			});
		});

		it('should reject rcpt before mail', function(done) {
			smtp.write('RCPT TO: <admin>\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('503 ');
				done();
			});
		});

		it('should reject data before rcpt', function(done) {
			smtp.write('DATA\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('503 ');
				done();
			});
		});

		it('should reject empty helo', function(done) {
			smtp.write('HELO\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('501 ');
				done();
			});
		});

		it('should accept helo with hostname', function(done) {
			smtp.write('HELO localhost\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('250 ');
				done();
			});
		});

		it('should list STARTTLS on ehlo for unsecure connections', function(done) {
			smtp.write('EHLO localhost\r\n');
			var foundSTARTTLS = false;
			var check = function(data) {
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

		it('should not list STARTTLS on ehlo for secure connections', function(done) {
			smtps.write('EHLO localhost\r\n');
			var foundSTARTTLS = false;
			var check = function(data) {
				data.toString().should.startWith('250');
				if (data.toString().indexOf('STARTTLS') !== -1) foundSTARTTLS = true;
				if (data.toString().indexOf('250 ') !== -1) {
					foundSTARTTLS.should.not.be.ok;
					done();
				} else {
					smtps.once('data', check);
				}
			}
			smtps.once('data', check);
		});

		it('should upgrade the connection on STARTTLS', function(done) {
			smtp.write('STARTTLS\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('220');
				var ctx = tls.createSecureContext(data.session.config.tls);
				var pair = tls.createSecurePair(ctx, false, false, true);
				pair.encrypted.pipe(smtp).pipe(pair.encrypted);
				pair.once('secure', function() {
					pair.cleartext.write('EHLO localhost\r\n');
					var foundSTARTTLS = false;
					var check = function(data) {
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

		it('should accept plain auth', function(done) {
			smtp.write('AUTH PLAIN ' + new Buffer('user\x00user\x00\password').toString('base64') + '\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('235');
				should(data.session.accepted.auth).be.ok;
				done();
			});
		});

		it('should reject empty mail', function(done) {
			smtp.write('MAIL\r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('501');
				done();
			});
		});

		it('should reject incomplete mail', function(done) {
			smtp.write('MAIL FROM: \r\n');
			smtp.once('data', function(data) {
				data.toString().should.startWith('501');
				done();
			});
		});

		it('should accept bounce mail (<>)', function(done) {
			smtp.write('MAIL FROM: <>\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('250');
				should(data.session.envelope.from).be.ok;
				data.session.envelope.from.should.equal('<>');
				data.session.accepted.mail.should.be.ok;
				done();
			});
		});

		it('should not accept nested mail', function(done) {
			smtp.write('MAIL FROM: <>\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('503');
				should(data.session.rejected.mail).be.ok;
				done();
			});
		});

		it('should accept mail without <>', function(done) {
			data.session.accepted.mail = false;
			data.session.envelope.from = null;
			smtp.write('MAIL FROM: test@localhost\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('250');
				data.session.envelope.from.should.equal('test@localhost');
				data.session.accepted.mail.should.be.ok;
				done();
			});
		});

		it('should reject empty rcpt', function(done) {
			smtp.write('RCPT\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('501');
				should(data.session.accepted.rcpt).not.be.ok;
				done();
			});
		});

		it('should reject incomplete rcpt', function(done) {
			smtp.write('RCPT TO: \r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('501');
				should(data.session.accepted.rcpt).not.be.ok;
				done();
			});
		});

		it('should accept rcpt without <>', function(done) {
			smtp.write('RCPT TO: test@localhost\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('250');
				data.session.envelope.to.indexOf('test@localhost').should.not.equal(-1);
				data.session.accepted.rcpt.should.be.ok;
				done();
			});
		});

		it('should accept additional rcpt', function(done) {
			smtp.write('RCPT TO: test2@localhost\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('250');
				data.session.envelope.to.indexOf('test2@localhost').should.not.equal(-1);
				data.session.envelope.to.length.should.equal(2);
				data.session.accepted.rcpt.should.be.ok;
				done();
			});
		});

		it('should not add duplicate recipients', function(done) {
			smtp.write('RCPT TO: test2@localhost\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('250');
				data.session.envelope.to.indexOf('test2@localhost').should.not.equal(-1);
				data.session.envelope.to.length.should.equal(2);
				done();
			});
		});

		it('should not relay unauthenticated for local sender and local recipient', function(done) {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@localhost';
			delete data.session.accepted.auth;
			delete data.session.rejected.auth;
			delete data.session.user;
			smtp.write('RCPT TO: <test2@localhost>\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('502');
				done();
			});
		});

		it('should not relay unauthenticated for local sender and remote recipient', function(done) {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@localhost';
			delete data.session.accepted.auth;
			delete data.session.rejected.auth;
			delete data.session.user;
			smtp.write('RCPT TO: <test@remote>\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('502');
				done();
			});
		});

		it('should relay unauthenticated for remote sender and local recipient', function(done) {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@remote';
			delete data.session.accepted.auth;
			delete data.session.rejected.auth;
			delete data.session.user;
			smtp.write('RCPT TO: <test@localhost>\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('should relay authenticated for local sender and remote recipient', function(done) {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@localhost';
			data.session.accepted.auth = 235;
			data.session.user = { username: 'username', password: 'password' };
			delete data.session.rejected.auth;
			smtp.write('RCPT TO: <test@remote>\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('should relay authenticated for local sender and local recipient', function(done) {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@localhost';
			data.session.accepted.auth = 235;
			data.session.user = { username: 'username', password: 'password' };
			delete data.session.rejected.auth;
			smtp.write('RCPT TO: <test@localhost>\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('should not relay authenticated for remote sender and remote recipient', function(done) {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@remote';
			data.session.accepted.auth = 235;
			data.session.user = { username: 'username', password: 'password' };
			delete data.session.rejected.auth;
			smtp.write('RCPT TO: <test@remote>\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('502');
				done();
			});
		});

		it('should relay authenticated for remote sender and local recipient', function(done) {
			data.session.accepted.mail = 250;
			data.session.envelope.from = 'test@remote';
			data.session.accepted.auth = 235;
			data.session.user = { username: 'username', password: 'password' };
			delete data.session.rejected.auth;
			smtp.write('RCPT TO: <test@localhost>\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('250');
				done();
			});
		});

		it('should accept data', function(done) {
			smtp.write('DATA\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('354');
				done();
			});
		});

		it('should write gtube message', function(done) {
			var file = fs.createReadStream(__dirname + '/assets/gtube.msg');
			file.pipe(smtp, { end: false });
			file.once('end', function() {
				smtp.write('\r\n.\r\n');
				smtp.once('data', function(res) {
					res.toString().should.startWith('250');
					done();
				});
			});
		});

		it('should have increased the transaction id to 1', function() {
			data.session.transaction.should.equal(1);
		});

		it('should have a spamd score', function() {
			should(data.session.data.queue.spamd.score).be.type('number');
		});

		it('should quit', function(done) {
			smtp.write('QUIT\r\n');
			smtp.once('data', function(res) {
				res.toString().should.startWith('221');
				done();
			});
		});

		it('should be disconnected', function(done) {
			data.session.connection.closed.should.be.true;
			done();
		});

	});

}()
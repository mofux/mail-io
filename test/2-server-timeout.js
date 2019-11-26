module.exports = function() {

  let should = require('should');
  let net = require('net');
  let tls = require('tls');
	let SMTPServer = require('../src/smtp-server.js');

  // set to true to enable debug output
  let debug = true;

  describe('server idle disconnect', function() {

    this.timeout(10000);

    let server = new SMTPServer({
      port: 2725,
      logger: { verbose: debug ? console.log : function() {} },
      domains: ['localhost'],
      limits: {
        idleTimeout: 1000
      }
    });

		server.listen(2725);

    let client = net.connect({port: 2725});

    it('should greet on smtp', function(done) {

      client.once('data', function(data) {
        data.toString().should.startWith('220 ');
        done();
      });

    });

    it('should upgrade the connection on STARTTLS', (done) => {
      client.write('STARTTLS\r\n');
      client.once('data', (res) => {
        res.toString().should.startWith('220');
        let ctx = tls.createSecureContext(server.config.tls);
        client = tls.connect({ secureContext: ctx, socket: client });
        client.once('secure', () => {
          let foundSTARTTLS = false;
          let check = (data) => {
            data.toString().should.startWith('250');
            if (data.toString().indexOf('STARTTLS') !== -1) foundSTARTTLS = true;
            if (data.toString().indexOf('250 ') !== -1) {
              foundSTARTTLS.should.not.be.ok;
              done();
            } else {
              client.once('data', check);
            }
          }
          client.once('data', check);
          client.write('EHLO localhost\r\n');
        });
      });
    });

    it('should get disconnected within 1 second idle', function(done) {

      let answered = false;

      // expect the disconnect message next
      client.once('data', function(data) {
        if (answered) return;
        answered = true;
        data.toString().should.startWith('451 ');
        done();
      });

      // wait 2 seconds, we should be disconnected after one already
      setTimeout(function() {

        if (answered) return;
        done(new Error('not disconnected after 2 seconds!'));

      }, 2000);

    });

    it('smtps server should have no open connections', function(done) {

			server.getConnections(function(err, count) {
				if (err) return done(err);
				count.should.equal(0);
				done();
			});

		});

  });

}();

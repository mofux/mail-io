module.exports = {

	description: 'core implementation for STARTTLS command',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// make sure the session is not already secured
		if (req.session.secure === true) return res.reject(554, 'tls already active');

		// remove the old socket
		req.session.connection.socket.unpipe(req.session.connection);

		// ignore any commands as long as the session is upgrading
		req.session.connection.busy = true;

		// accept the tls request
		res.accept(220, 'OK');

		// initialize tls
		var tls = require('tls');

		var ctx = tls.createSecureContext(req.session.config.tls);
		var opts = {
			secureContext: ctx,
			isServer: true,
			server: req.session.connection.server,

			// throws if SNICallback is missing, so we set a default callback
			SNICallback: function(servername, cb) {
				cb(null, ctx);
			}
		};

		// remember old event handlers, then remove them
		var events = req.session.connection.socket._events;
		req.session.connection.socket.removeAllListeners();

		// upgrade the connection
		var socket = new tls.TLSSocket(req.session.connection.socket, opts);

		// assign the old event handlers to the new socket
		socket._events = events;

		// wait for the socket to be upgraded
		socket.once('secure', function() {

			req.session.reset();
			req.session.secure = true;
			req.session.connection.busy = false;
			req.session.connection.socket = socket;
			req.session.connection.socket.pipe(req.session.connection);

		});

	}

}
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
		let tls = require('tls');

		let ctx = tls.createSecureContext(req.session.config.tls);
		let opts = {
			secureContext: ctx,
			isServer: true,
			server: req.session.connection.server
		};

		// remember old event handlers, then remove them
		let events = req.session.connection.socket._events;
		req.session.connection.socket.removeAllListeners();

		// upgrade the connection
		let socket = new tls.TLSSocket(req.session.connection.socket, opts);
		let base = req.session.connection.socket;

		// add idle timeout
		socket.setTimeout(req.session.config.limits.idleTimeout);

		// add socket.close method, which really closes the connection
		socket.close = function(data) {

			// only continue if the socket is not already destroyed
			if (socket.destroyed) return base.close();

			// destroy immediately if no data is passed, or if the socket is not writeable
			if (!data || !socket.writable) {

				socket.end();
				socket.destroy();
				base.close();

			}

			// write the data to the socket, then destroy it
			socket.write(data, function() {

				// end the socket
				socket.end();

				// destroy the socket
				socket.destroy();

				// close the base socket
				base.close();

			});

		};

		// assign the old event handlers to the new socket
		socket._events = events;

		// catch error events that happen before the upgrade is done
		socket.on('clientError', (err) => {
			res.log.warn('error while upgrading the connection to TLS: ', err);
		});

		// wait for the socket to be upgraded
		socket.once('secure', () => {

			// reset the session and connect the new tls socket
			req.session.reset();
			req.session.secure = true;
			req.session.connection.busy = false;
			req.session.connection.socket = socket;
			req.session.connection.socket.pipe(req.session.connection);

		});

	}

}

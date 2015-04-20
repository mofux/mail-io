# connect/core

This `core` plugin adds support for the `connect` event that is triggered whenever a client connects and is responsible for sending the initial greeting.

You can configure the maximum connection count in the server configuration using `limits.maxConnections` (defaults to `100`).
If the amount of active client connections to the server exceeds `limits.maxConnections`,
the client will be disconnected with a `421 too many client connections` error.

## example

If you want to add custom connect logic, you can do it like this:

```javascript

var mailio = require('mail-io');
var server = mailio.createServer({...}, function(session) {

	session.on('connect', function(req, res) {

		// only accept clients that have an ip in the 192.168.0.x range
		if (req.session.client.address.indexOf('192.168.0.') === -1) {
			res.end(521, 'we only accept clients from our local subnet, sorry');
		} else {
			res.accept();
		}

	});

});

```

# auth/core

This `core` plugin adds support for the `AUTH` command for the login methods `PLAIN` and `LOGIN`.

Once the client has provided all the authentication data needed, it sets `req.user` to an object containing the clear text `username` and `password` fields.
If there are no more `auth` handlers, clients will be treated as authenticated as there is no logic to check if a user should pass or not.

If you want to implement your own authentication logic, register to the `auth` event and check `req.user` to match your user base.
If you want to reject the `auth` request, call `res.reject(535, 'authentication failed')` to signal that the authentication failed.
If you want to accept the `auth` request, call `res.accept(<code>, <message>)` with an optional `code` and `message`.
If you do not provide a code and a message to the `res.accept` function, a `235 authentication successful` message will be sent back to the client.

> Note: to check if a client was authenticated in any other command handler, you should check `req.session.accepted.auth`, which will be set once a client was successfully authenticated.

By default (if not altered by your server configuration) sending (relaying) mails to external domains is only allowed by authenticated users. In additional, DNSBL lookups are disabled if a client is authenticated to make sure users sending from your domain are not getting blocked.

## example

In this example, we only let user `John` with password `Doe` pass:

```javascript

var mailio = require('mail-io');
var server = mailio.createServer({...}, function(session) {

	session.on('auth', function(req, res) {

		// this server is for John only
		if (req.user.username !== 'John' && req.user.password !== 'Doe') {
  		return res.reject(535, 'only John is allowed to authenticate');
  	} else {
  		return res.accept(235, 'welcome John');
  	}

	});

});

```

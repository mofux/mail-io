# rcpt/core

This `core` plugin adds support for the `RCPT` command. It makes sure that all preconditions are met, tries to parse the recipient
and if everything is okay adds the recipient to the `req` object as `req.to`, so following plugins can work with it.

The `rcpt` handler is the perfect place to perform checks on the client and the message envelope and either accept or reject any further communication, because at
this point the whole mail envelope is populated.

So, for example, if you want to reject any mail that is not send to the address `me@example.com`, you could write a handler like this:

```javascript```

var mailio = require('mail-io');
var server = mailio.createServer({..}, function(session) {

	session.on('rcpt', function(req, res) {

		if (req.to !== 'me@example.com') {
			res.reject(551, 'I am only accepting mail to "me@example.com"');
		} else {
			res.accept();
		}

	});

});

```
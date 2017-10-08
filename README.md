# mail-io

[![Build Status](https://travis-ci.org/mofux/mail-io.png?branch=master)](https://travis-ci.org/mofux/mail-io)

This module provides an easy way to implement your own SMTP server.
It supports plugins and can be easily extended.

It also supports mail relay features.

## usage

You can create a server like this:

```javascript

// Load the module
const mio = require('mail-io');

// Create a new SMTP server
const server = new mio.Server({ ... options ... });

// Listen for new client connections
server.on('session', (session) => {
	
	// Register a custom authentication handler
	session.on('auth', (req, res) => {
		
		// Only accept user "john" with password "doe"
		if (req.user && req.user.username === 'john' && req.user.password === 'doe') {
			return res.accept(250, 'OK');
		} else {
			return res.reject(535, 'Authentication failed');
		}
		
	});
	
});

// Register a global handler to reject all recipients that do not belong
// to "foo.com" domain
server.addHandler('rcpt', {
	name: 'my-rcpt-handler',
	before: 'dnsbl',
	handler: (req, res) => {
		
		if (req.to.split('@')[1] === 'foo.com') {
			res.accept();
		} else {
			res.reject(502, 'We only accept mail for the "foo.com" domain');
		}
		
	}
});

// Listen on port 25
server.listen(25);

```

## command handlers

You can register command handlers with `session.on('command', function(req, res) {...})` for any command, which will get called when the command is issued by the client and previous handlers (if any) have accepted the request.
In the background, the handler will be pushed to the end of the handler queue, so it will only get called if all previous handlers for this command accepted with `res.accept`.
Note that the `core` plugin always gets precedence over any other plugins, which makes sure that internally used plugins execute first.

A command handler is a function that gets passed two objects, `req` and `res`.

### **req** object

The `req` object contains the issued command and the data, information about the session and the plugin specific configuration (if provided). The req object is shared between all handlers of the same command. It contains the following attributes:

**command**

the `command`object contains the `cmd` property which contains the name of the command in lowercase letters, e.g. `mail` or `rcpt`. It also contains a `data` property which is a string that contains the `data` that came after the command.

**session**

the `session` object is initialized upon a client connection and is shared between all handlers. It contains the following attributes:

- `id`: a unique id for every client session
- `transaction`: the id of the current transaction, starting at `0` and getting increased after every successful `data` command
- `accepted`: a map that contains all commands as the key that have been accepted. The value is the status code. **NOTE** this is very useful to check if a command has been completed
- `rejected`: same as `accepted`, but for commands that have been rejected
- `envelope`: a map that contains the mail envelope data, like `to *(array)*` and `from *(string)*`
- `client`: an object containing information about the connected client, like `address` and `hostname`
- `config`: a reference to the options passed to the `createServer` constructor
- `connection`: the underlying `smtp-stream` connection. `connection.socket` contains the raw net socket of the connection.
- `handlers`: a map that contains all registered command handlers. You shouldn't have to mess around with it, but just in case :)
- `data`: a map containing the commands as the key and a map of handlers as the value, which in turn contain the data that was set using `res.set`. You should not access this data directly and rather use `res.get` to obtain the data
- `secure`: a boolean indicating if the connection is using TLS. 
- `counters`: a map of counters that are used internally to track failed login and command attempts
- `log`: a map that contains logging functions for different levels. You should NOT use this and rather use `res.log` instead.

**config**

Contains the handler specific configuration that was passed via the `options` in the `createServer` constructor. 
For example, to pass a custom DNSBL blacklist server to `rcpt/dnsbl` plugin, the options object may look like this:

```javascript
const server = new mio.Server ({
	plugins: {
		'rcpt/dnsbl': {
			blacklist: 'zen.spamhaus.org'
		}
	}
}, function() {...})
```

**more**

Some `core` plugins extend the `req` object, so you may have additional data available on the `req` object. For example the `auth/core` plugin adds `req.user` to the request if the `auth` request was completed successfully. `mail/core` adds `req.from` and `rcpt/core` adds `req.to`.


### **res** object

The `res` object contains methods that can be used to respond to the command, and to add additional information to the session. 
**IMPORTANT** You *MUST* call either `res.accept`, `res.reject` or `res.end` exactly once during the execution of your handler code, otherwise the connection will be left hanging.

It contains the following methods:

**accept**(`<code>`, `<message>`)

Accepts the request. You can pass an optional response `code` and `message` which will be used when sending the response to the client. Note that if there are remaining handlers for this command, they will be called afterwards and may also change the code and message, or even reject the request. This means that accepting a request with `res.accept` does not guarantee that this response will be sent to the client as is.
If you do not pass a response code or message, the default `code` is `250` and the default `message` is `OK` 

**reject**(`code`, `message`)

If you `reject` a request, the response is immediately sent to the client and no more handlers for this command will be executed. You **MUST** to provide a `code` and a `message` when you reject. You should make sure that the `code` is appropriate for the command you are rejecting, otherwise, the client may misunderstand your answer.

**end**(`<code>`, `<message>`)

When calling `end`, the connection to the client will be closed. No more command handlers will be executed. You can pass an optional `code` and `message` to the `end` method, which will write the response to the client before closing the connection.

**write**(`message`)

In some situations it is required to send a `message` to the client. For example, the `ehlo` commands sends a list of supported features to the client before `accept`ing the request. Write does not end the current command handler and you are still required to either `accept`, `reject` or `end` the request before the execution can continue.

**read**(`callback`)

Sometimes, you may need additional information from the client (see `auth/core`) that has to be read within the same command handler. For this case, use `res.read` and provide a callback function, that will be called back with the data received from the client.

**set**(`data`)

If you want to share data with other handlers, `set` will allow you to do that. You can pass any `data`, which other handlers can get using `res.get`.

**get**(`handler`)

If you want to access data from another command handler, you can use `get`. `handler` is a string that accepts two flavors:

- `command`: gets all stored data for a specific `command`. The returned object will be a map containing the name of the handler as the key and their stored data as the value.
- `command/handler`: returns the data stored by that handler

As an example, the `spamd` plugin is registered to the `queue` command. When it receives a spam score, it will be saved using `res.set(score)`. If you want to access that data, you could call `res.get('queue/spamd')`, which would directly return the score, or you could call `res.get('queue')` which would return an object with `spamd` as a key and the score as the value.

> Note: you can also access the same data via `req.session.data.queue.spamd`.

**log** `<object>`

`res.log` is an object that contains functions for the logging levels `info`, `warn`, `error`, `verbose` and `debug`. If you want to log some information, you should use these logging functions. They accept a `message` as the first argument and any `data` as the following arguments, that will be printed as separate lines using `util.inspect`. 


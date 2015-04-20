# starttls/core

This `core` plugin provides support for the `STARTTLS` command.
It allows a client to upgrade an insecure connection using `STARTTLS`.

> Note, by default we deliver a self-signed certificate that should be only used for testing purposes.
> If you run the server in production, you should setup your own certificates by providing 'tls' object to the server configuration.

The tls configuration object in the server configuration by default looks like this:

```javascript

{
	... server configuration ...,
	tls: {
		key: fs.readFileSync(__dirname + '/../keys/key.pem'),
		cert: fs.readFileSync(__dirname + '/../keys/cert.pem'),
		ca: fs.readFileSync(__dirname + '/../keys/ca.pem'),
		ciphers: 'ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA',
		honorCipherOrder: true
	}
}

```

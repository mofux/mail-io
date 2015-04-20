# queue/spamd

This plugin adds support for spam detection using SpamAssassin. The plugin is enabled by default.
It tries to connect to the SpamAssassin daemon on localhost on port 783. It sets a spam report using `res.set`, which can
be retrieved by following plugins using `res.get('queue/spamd'). The plugin itself does always `accept` the request, no matter
how bad the score is. It is up for the following plugins to decide how to react to the spam score.

The score object that can be retrieved using `res.get('queue/spamd')` looks like this:

```javascript

{
	spam: true,
	score: 6.2,
	baseScore: 5
}

```

If the connection to the SpamAssassin daemon fails or a timeout occurs, the spam object will look like this:

```

{
	spam: false,
	score: 0,
	baseScore: 5
}

```

You can configure the base score (every score above the base score will result in the `spam` attribute being true) using
the plugin specific configuration:

```javascript

{
	... server configuration ...,
	plugins: {
		'queue/spamd': {
			// any message that scores higher will be treated as spam! defaults to 5
			baseScore: 5
		}
	}
}

```

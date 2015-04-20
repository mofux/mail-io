# rcpt/dnsbl

This plugin provides support for DNS blacklisting. It looks up a specified blacklist server (by default `zen.spamhaus.org`) and stops a client
from sending any data if it is listed by rejecting the `RCPT` command with a detailed error message why the client got blacklisted.
This plugin is enabled by default.

> Note: some blacklisting servers (like spamhaus.org) do not resolve blacklist entries properly when using the Google Public DNS servers.
> To work around this issue, the plugin uses the OpenDNS server for DNS lookups by default.

You can change the plugin settings in the plugin specific configuration of your server configuration:

```javascript

{
	... server configuration ...,
	plugins: {
		'rcpt/dnsbl': {
			// the blacklist service to use for DNSBL filtering
			blacklist: 'zen.spamhaus.org',
			// the dns server used to resolve the listing
			// note: when using google public dns servers, some dnsbl services like spamhaus won't resolve properly
			// so you can set a different dns resolver here
			resolver: '208.67.222.222'
		}
	}
}

```

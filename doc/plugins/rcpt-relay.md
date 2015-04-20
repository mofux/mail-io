# rcpt/relay

This plugin makes sure to only accept mail that complies to the relay configuration setting.
By default, it only accepts a mail in the following cases:
	- sender or recipient or both belong to a local domain (`config.domains`)
	- if the recipient belongs to a remote domain, the client has to be authenticated
	- if the sender belongs to a local domain, the client has to be authenticated


General relay configuration options can be passed to the server in the server configuration using the 'relay' object:

```javascript

{
	... server configuration...,
	relay: {
		// should we relay messages?
		enabled: true,
		// allow relay to foreign domains if the sender is not authenticated?
		allowUnauthenticated: false,
		// do we relay mail from senders that do not belong to our served domains (config.domains)?
		openRelay: false,
		// the hostname used to identify to the receiving server in the "EHLO" command, defaults to os.hostname()
		hostname: os.hostname(),
		// the directory used to store queued messages, defaults to /tmp/mail-io-queue
		queueDir: path.join(os.tmpDir(), 'mail-io-queue'),
		// the amount of hours that we will try to resubmit the message if the submission fails with a temporary error
		// defaults to 48 hours
		retryHours: 48,
		// the base interval in seconds, that specifies how long to wait until we try to resubmit a failed message
		// this inverval will be multiplied with the square of failed attempts, so the time between resubmissions
		// will increase with every failed attempt. defaults to 60 seconds
		retryBaseInterval: 60,
		// the maximum amount of concurrent transactions, defaults to 5
		concurrentTransactions: 5
}

```

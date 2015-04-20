# queue/relay

This plugin adds support for relaying (sending) messages to foreign SMTP servers.

Once the message has arrived, this plugin checks if it should relay the message to a foreign SMTP server.
If it is allowed to relay, it will try to send the message to the target server. If the message can not be submitted
without an error, it will either queue the message for another delivery attempt or, if the error returned from the receiving
server is permanent (error code > 500), will send a non deliverable report (NDR) to the sender of the message. If the message
cannot be successfully submitted after a specified amount of time, it will give up and send a NDR to the sender.

By default, relaying is only enabled for the following scenarios:

- the client is authenticated
- the `from` address belongs to a local domain (configured in the server configuration `domains` array)
- the `to` address does not belong to a local domain


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

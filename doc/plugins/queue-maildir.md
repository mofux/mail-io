# queue/maildir

This plugin adds support for storing messages in the popular `maildir` format (see http://en.wikipedia.org/wiki/Maildir). This plugin is enabled by default.
When a message is queued, the plugin checks if the recipient or sender of the message belongs to the domains served by the server.
If they do, the server calls the extend function (if configured) to determine the target mailboxes.
If the mail was sent by a local user, the message will be stored inside the "Sent" folder of that mailbox.
If the mail is received by a local user, the spam score of the message will be checked, and the message will be saved to the
"Inbox" or the "Junk" folder of the recipient. If you want to use this plugin, you should configure the `mailDir` configuration option
to point to a persistent store location in your system (by default mails are stored to `/tmp/mail-io-maildir`). The mailDir path setting uses placeholders
for username (`%n`) and domain (`%d`) that will be replaced with the user and domain part extracted from the target address.

The following plugin specific configuration options are available:

```javascript

{
	... server configuration ...,
	plugins: {
		'queue/maildir': {
			// maildir storage location. %n will be replaced with the username and %d with the domain name, parsed from the address
      mailDir: path.join(os.tmpDir(), 'mail-io-maildir', '%d', '%n'),
      // an optional function that will be called for every address matching a local domain. it has to call back with an array of addresses
      // of the target mailboxes
      extend: function(address, cb) { cb([address]) }
		}
	}

```

## understanding the extend function

Let's say you want to implement distribution lists. So, if a mail is sent to distribution list address `group@example.com`, you want the message being stored
in the inbox of group members `john@example.com` and `jane@example.com`. In this case you would supply the extend function as follows:

```javascript

{
	... server configuration ...,
	plugins: {
		'queue/maildir': {
			extend: function(address, cb) {
				var groups = {
					'group@example.com': ['john@example.com', 'jane@example.com']
				};
				if (groups[address]) {
					// address belongs to a distribution list, return member addresses
					cb(groups[address]);
				} else {
					// address does not belong to a distribution list
					cb(address);
				}
			}
		}
	}


```

Now, if a message is sent to your distribution list, the maildir plugin will save the message to the inbox of John and Jane, and not to the
inbox of 'group'.

Another use case is to only store mails for accounts that really exist in your system. To prevent mails from being stored for accounts that do not exist,
you could implement the extend function like this:

```javascript

{
	... server configuration ...,
	plugins: {
		'queue/maildir': {
			extend: function(address, cb) {

				var accounts = ['john@example.com', 'jane@example.com'];

				// only save mail for known accounts
				if (accounts.indexOf(address) === -1) {
					// address is not in the list of accounts,
					// return an empty list
					return cb([]);
				} else {
					// address is in the list of known accounts,
					// return the address
					return cb(address);
				}

			}
		}
	}


```

> Note: remember to account for special addresses like `mailer-daemon`, `postmaster` and `admin` that are widely used in the internet to send
> administrative messages to your domain

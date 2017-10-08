module.exports = {

	description: 'core implementation for RCPT command',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// module dependencies
		let net = require('net');
		let dns = require('native-dns');
		let Address6 = require('ip-address').Address6;

		// skip the check if the sender is authenticated
		if (req.session.accepted.auth) {
			res.log.verbose('Client authenticated. Skipping dnsbl lookup.');
			return res.accept();
		}

		// get the sender ip
		let ip = req.session.client.address;

		// do not perform a lookup for loopback addresses (useful for testing)
		if (ip && ip.indexOf('127.0.0.1') !== -1) {
			res.log.verbose('Client ip is a loopback address. Skipping dnsbl lookup.');
			return res.accept();
		}

		// get the blacklist names
		let blacklist = req.config.blacklist || 'zen.spamhaus.org';

		// stores the reversed ip address
		let reversed = null;

		// check the address
		if (net.isIPv4(ip)) {

			// reverse the address by splitting the dots
			reversed = ip.split('.').reverse().join('.');

		} else if (ip.indexOf('::ffff:') === 0 && ip.split('.').length === 4) {

			// ipv6 representation of an ipv6 address
			reversed = ip.replace('::ffff:', '').split('.').reverse().join('.');

		} else  if (net.isIPv6(ip)) {

			reversed = new Address6(ip).reverseForm({ omitSuffix: true });

		}

		// if we were not able to reverse the address, accept
		if (!reversed) {
			res.log.verbose('Unable to parse ip address "' + ip + '"');
			return res.accept();
		}

		// perform a DNS A record lookup for that entry
		let record = reversed + '.' + blacklist;

		// perform the dns lookup
		dns.resolve(record, 'A', req.config.resolver || null, (err, codes) => {

			// if an error occurred (most likely NXDOMAIN which is the expected response if the host is not listed)
			// or if now addresses where returned, we can accept the request
			if (err || !codes) {
				res.log.verbose('DNSBL lookup for "' + record +'" did not resolve. assuming ip to be ok.')
				return res.accept();
			}

			// query additional txt information which may contain more information
			// about the block reason
			dns.resolve(record, 'TXT', req.config.resolver || null, function(err, infos) {
				res.log.verbose('DNSBL lookup for "' + record + '" resolved. rejecting client [' + ip + '].' + (infos ? ' reason: ' + infos.join(';') : ''));
				res.reject(550, 'Service unavailable; Client host [' + ip + '] blocked using ' + blacklist + '; ' + (infos ? infos.join(';') : ''));
			});

		});

	}

}

module.exports = {

	description: 'core implementation for RCPT command',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// module dependencies
		var net = require('net');
		var dns = require('dns');
		var ipv6 = require('ipv6').v6;

		// skip the check if the sender is authenticated
		if (req.session.accepted.auth) return res.accept();

		// get the sender ip
		var ip = req.session.client.address;

		// do not perform a lookup for loopback addresses (useful for testing)
		if (ip && ip.indexOf('127.0.0.1') !== -1) return res.accept();

		// get the blacklist names
		var blacklist = req.config.blacklist || 'zen.spamhaus.org';

		// stores the reversed ip address
		var reversed = null;

		// check the address
		if (net.isIPv4(ip)) {

			// reverse the address by splitting the dots
			reversed = ip.split('.').reverse().join('.');

		} else  if (net.isIPv6(ip)) {

			// reverse the address by splitting the colons and filling the remaining space
			reversed = new ipv6.Address(ip).parsedAddress.map(function(part) {
				while(part.length < 4) part = '0' + part;
				return part.split('').reverse().join('.');
			}).reverse().join('.');

		}

		// if we were not able to reverse the address, accept
		if (!reversed) return res.accept();

		// perform a DNS A record lookup for that entry
		var record = reversed + '.' + blacklist;

		dns.resolve(record, 'A', function(err, addresses) {

			// if an error occurred (most likely NXDOMAIN which is the expected response if the host is not listed)
			// or if now addresses where returned, we can accept the request
			if (err || !addresses) return res.accept();

			// query additional txt information which may contain more information
			// about the block reason
			dns.resolveTxt(record, function(err, infos) {
				res.reject(550, 'service unavailable; client host [' + ip + '] blocked using ' + blacklist + '; ' + (infos ? infos.join(';') : ''));
			});

		});

	}

}
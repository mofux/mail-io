module.exports = {

	description: 'core implementation for RCPT command',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// module dependencies
		var net = require('net');
		var dns = require('dns');
		var ipv6 = require('ipv6').v6;

		// skip the check if the sender is authenticated
		if (req.session.accepted.auth) {
			res.log.verbose('client authenticated. skipping dnsbl lookup.');
			return res.accept();
		}

		// get the sender ip
		var ip = req.session.client.address;

		// do not perform a lookup for loopback addresses (useful for testing)
		if (ip && ip.indexOf('127.0.0.1') !== -1) {
			res.log.verbose('client ip is a loopback address. skipping dnsbl lookup.');
			return res.accept();
		}

		// get the blacklist names
		var blacklist = req.config.blacklist || 'zen.spamhaus.org';

		// stores the reversed ip address
		var reversed = null;

		// check the address
		if (net.isIPv4(ip)) {

			// reverse the address by splitting the dots
			reversed = ip.split('.').reverse().join('.');

		} else if (ip.indexOf('::ffff:') === 0 && ip.split('.').length === 4) {

			// ipv6 representation of an ipv6 address
			reversed = ip.replace('::ffff:', '').split('.').reverse().join('.');

		} else  if (net.isIPv6(ip)) {

			// reverse the address by splitting the colons and filling the remaining space
			reversed = new ipv6.Address(ip).parsedAddress.map(function(part) {
				while(part.length < 4) part = '0' + part;
				return part.split('').reverse().join('.');
			}).reverse().join('.');

		}

		// if we were not able to reverse the address, accept
		if (!reversed) {
			res.log.verbose('unable to parse ip address "' + ip + '"');
			return res.accept();
		}

		// perform a DNS A record lookup for that entry
		var record = reversed + '.' + blacklist;

		dns.resolve(record, 'A', function(err, addresses) {

			// if an error occurred (most likely NXDOMAIN which is the expected response if the host is not listed)
			// or if now addresses where returned, we can accept the request
			if (err || !addresses) {
				res.log.verbose('dnsbl lookup for "' + record +'" did not resolve. assuming ip to be ok.')
				return res.accept();
			}

			// query additional txt information which may contain more information
			// about the block reason
			dns.resolveTxt(record, function(err, infos) {
				res.log.verbose('dnsbl lookup for "' + record + '" resolved. rejecting client [' + ip + '].' + (infos ? ' reason: ' + infos.join(';') : ''));
				res.reject(550, 'service unavailable; client host [' + ip + '] blocked using ' + blacklist + '; ' + (infos ? infos.join(';') : ''));
			});

		});

	}

}
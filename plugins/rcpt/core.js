module.exports = {

	description: 'core implementation for RCPT command',
	author: 'Thomas Zilz',
	requires: [],
	handler: function(req, res) {

		// make sure mail command was already issued
		if (!req.session.accepted.mail) return res.reject(503, 'need MAIL command');

		// make sure a recipient has been passed
		if (!req.command.data) return res.reject(501, 'incomplete RCPT command');

		// make sure the amount of recipients does not grow beyond limit
		if (req.session.envelope.to.length >= (req.session.config.limits.maxRecipients || 100)) return res.reject(502, 'too many recipients');

		// parse the rcpt
		var m = req.command.data.match(/^to\s*:\s*(\S+)(?:\s+(.*))?/i);
		if (!m) return res.reject(501, 'parse error in rcpt command');
		var to = m[1].replace(/^</, '').replace(/>$/, '').toLowerCase();

		// dispatch the rcpt address
		if (to) {
			req.to = to;
			res.accept(250, 'OK');
		} else {
			res.reject(501, 'bad syntax');
		}

	}

}
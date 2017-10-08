module.exports = {

	description: 'core implementation for MAIL command',
	author: 'Thomas Zilz',
	handler: function(req, res) {

		// make sure HELO or EHLO were accepted
		if (!req.session.accepted.helo && !req.session.accepted.ehlo) return res.reject(503, 'Need HELO or EHLO command');

		// make sure the command has data
		if (!req.command.data) return res.reject(501, 'Incomplete MAIL command');

		// do not allow multiple mail commands for one transaction
		if (req.session.accepted.mail && req.session.transaction < 1) return res.reject(503, 'Nested MAIL command');

		// the mail command may specify the size of the message like this MAIL FROM:<some@thing.com> SIZE=1024000
		if (req.session.config.limits.messageSize && req.command.data.toLowerCase().indexOf(' size=')) {
			
			// size has been specified, try to get the message size
			let size = parseInt(req.command.data.substring(req.command.data.toLowerCase().indexOf(' size=') + 6));
			if (!isNaN(size) && size > req.session.config.limits.messageSize) return res.reject(552, 'Message size exceeds fixed maximum message size (' + req.session.config.maxMessageSize + ' bytes)');
			
		}

		// parse the from
		let m = req.command.data.match(/^from\s*:\s*(\S+)(?:\s+(.*))?/i);
		if (!m || !m[1] || !m[1].length) return res.reject(501, 'Parse error in mail command');
		let from = m[1] === '<>' ? '<>' : m[1].replace(/^</, '').replace(/>$/, '').toLowerCase();

		// dispatch the from address
		if (from) {
			req.from = from;
			res.accept(250, 'OK');
		} else {
			res.reject(501, 'Bad syntax');
		}

	}
}
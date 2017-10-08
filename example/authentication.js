const mio = require('../src/index.js');
const server = new mio.Server({}, (session) => {

	session.on('auth', function(req, res) {

		// make sure tester/tester gets through
		if (req.user && req.user.username === 'tester' && req.user.password === 'tester') {
			res.accept();
		} else {
			res.reject(552, 'authentication failed');
		}

	});

});

server.listen(2525, () => console.log('SMTP server up on port 2525'));
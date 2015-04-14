/**
 * provides a queue that can run schedule jobs, respecting concurrency
 * @param opts options to configure "concurrency" and "interval"
 * @param cb
 * @returns {{id: (*|NodeJS.Timer), concurrency: (*|config.concurrency|concurrency|q.concurrency), tasks: Array, running: Array, schedule: schedule, kill: kill}}
 */
module.exports = function(opts, cb) {
	var q = {
		id: setInterval(function() {
			if (q.running.length >= q.concurrency) return;
			q.tasks.forEach(function(task) {
				// make sure the task is allowed to run
				if (q.running.length >= q.concurrency) return;
				if (task.running) return;
				if (task.time > new Date().getTime()) return;
				// if we got until here, the task qualifies for execution
				task.running = true;
				q.running.push(task);
				cb(task.task, function(err) {
					// remove the task
					q.running.splice(q.running.indexOf(task), 1);
					q.tasks.splice(q.tasks.indexOf(task), 1);
				});
			});
		}, opts && opts.interval ? opts.interval : 100),
		concurrency: opts && opts.concurrency ? opts.concurrency : 10,
		tasks: [],
		running: [],
		schedule: function(offset, task) {
			q.tasks.push({ time: new Date().getTime() + offset, task: task, running: false });
		},
		kill: function() {
			clearInterval(q.id);
			tasks = [];
		}
	}
	return q;
}
// dependencies
const _ = require('lodash');
const fs = require('fs');
const dns = require('dns');
const path = require('path');
const mkdirp = require('mkdirp');
const topsort = require('topsort');

/**
 * Static utility functions that are used thoughout the lib
 */
class SMTPUtil {
	
	/**
	 * Promise based fs.readFile wrapper
	 * 
	 * @param {string} path
	 * The path to the file to read
	 * 
	 * @return {Promise}
	 * A promise that resolves with the content of the file,
	 * or gets rejected with an error
	 */
	static readFile(path) {
		
		return new Promise((resolve, reject) => {
			fs.readFile(path, (err, data) => err ? reject(err) : resolve(data.toString()));
		});
		
	}
	
	/**
	 * Promise based fs.writeFile wrapper
	 * 
	 * @param {string} path
	 * The path to the file to write
	 * 
	 * @param {string} data
	 * The data to write
	 * 
	 * @return {Promise}
	 * A promise that resolves once the file is written,
	 * or gets rejected with an error
	 */
	static writeFile(path, data) {

		return new Promise((resolve, reject) => {
			fs.writeFile(path, data, (err) => err ? reject(err) : resolve());
		});

	}
	
	/**
	 * Promise based fs.readdir wrapper
	 * 
	 * @param {string} path
	 * The path of the directory to read
	 * 
	 * @return {Promise}
	 * A promise that resolves with an array of contents,
	 * or gets rejected with an error
	 */
	static readDir(path) {

		return new Promise((resolve, reject) => {
			fs.readdir(path, (err, data) => err ? reject(err) : resolve(data));
		});

	}
	
	/**
	 * Promise based mkdirp.
	 * Creates a directory recursively
	 * 
	 * @param {string} path
	 * The path of the directory to create
	 * 
	 * @return {Promise}
	 * A promise that resolves once done,
	 * or gets rejected with an error
	 */
	static mkdirp(path) {
		
		return new Promise((resolve, reject) => {
			mkdirp(path, (err) => err ? reject(err) : resolve());
		});
		
	}
	
	/**
	 * Promise based unlink.
	 * Unlinks a file from the file system.
	 * 
	 * @param {string} path
	 * The path to the file to unlink
	 * 
	 * @return {Promise}
	 * A promise that resolves once done,
	 * or gets rejected with an error
	 */
	static unlink(path) {
		
		return new Promise((resolve, reject) => {
			fs.unlink(path, (err) => err ? reject(err) : resolve());
		});
		
	}
	
	/**
	 * Promise based fs.exists wrapper
	 * 
	 * @param {string} path
	 * The path to check for existence
	 * 
	 * @return {Promise}
	 * A promise that resolves with true if the path exists,
	 * otherwise false
	 */
	static exists(path) {
		
		return new Promise((resolve, reject) => {
			fs.exists(path, (exists) => resolve(exists))
		});
		
	}
	
	/**
	 * Promise based dns.resolve
	 */
	static resolveDNS(host, type) {
		
		return new Promise((resolve, reject) => {
			dns.resolve(host, type, (err, res) => err ? reject(err) : resolve(res));
		});
		
	}

	/**
	 * Loads and returns the built-in command handlers
	 */
	static getHandlers(handlers, config) {

		// the directory path of our core plugins
		let corePluginDir = path.join(__dirname, '..', 'plugins');

		// the handlers that will be returned later on
		let plugins = _.isObject(handlers) ? _.cloneDeep(handlers) : {};

		// get all plugins
		let commands = fs.readdirSync(corePluginDir);

		// go over the commands, make sure it is a folder
		commands.forEach((command) => {

			let stats = fs.statSync(path.join(corePluginDir, command));
			if (stats.isDirectory()) {

				// scan the command dir for plugins
				let commandDir = path.join(corePluginDir, command);
				let commands = fs.readdirSync(commandDir);

				// check if the plugin is a file ending on .js
				commands.forEach((pluginName) => {
					
					// get path to the plugin file
					let pluginFile = path.join(commandDir, pluginName);
					if (pluginName.split('.')[pluginName.split('.').length - 1] !== 'js') return;

					// if it is a file, require it
					if (fs.statSync(pluginFile).isFile()) {
						if (!_.isArray(plugins[command])) plugins[command] = [];
						let module = require(pluginFile);

						// a module has to expose an object containing a handler function
						if (!_.isObject(module)) return console.log(`Plugin "${pluginName}" does not expose an object. ignoring.`);
						if (!_.isFunction(module.handler)) return console.log(`Plugin "${pluginName}" does not expose a "handle" function. ignoring.`);
						plugins[command].push({ name: pluginName.split('.')[0], handler: module.handler, after: module.after || module.requires || [], before: module.before || [] });
					}

				});

			}

		});

		// remove handlers that have been disabled in the plugin config
		Object.keys(plugins).forEach((command) => {

			plugins[command].forEach((handler, i) => {

				if (config && config.plugins && config.plugins[command + '/' + handler.name] === false) {
					// plugin has been disabled, remove it from the plugins list
					plugins[command].splice(i, 1);
				}

			});

		});

		// sort the handlers by their dependencies
		SMTPUtil.sortHandlers(plugins);

		// return the handlers
		return plugins;

	}
	
	/**
	 * Sorts the handlers by their dependency
	 * 
	 * @param {Object} handlers 
	 * A list of handlers, with the event as the key and an 
	 * array of handler definitions as value
	 */
	static sortHandlers(handlers) {
		
		Object.keys(handlers).forEach((command) => {

			// sort modules by their dependencies
			// uses the topsort algorithm to get
			// the dependency chain right
			let edges = [];

			handlers[command].forEach((handler) => {
				[].concat(handler.after || []).forEach((dep) => {
					// if the dependency was provided as cmd/plugin, ignore the cmd/ part
					if (dep && dep.split('/')[1]) dep = dep.split('/')[1];
					edges.push([dep, handler.name]);
				});
				[].concat(handler.before || []).forEach((dep) => {
					// if the dependency was provided as cmd/plugin, ignore the cmd/ part
					if (dep && dep.split('/')[1]) dep = dep.split('/')[1];
					edges.push([handler.name, dep]);
				});
				
				// add an implicit dependency to the core module,
				// so the core plugins always run first
				edges.push(['core', handler.name]);
				
			});

			let sorted = [];
			let unsorted = [];

			handlers[command].forEach((handler) => {
				let idx = topsort(edges).indexOf(handler.name);
				idx === -1 ? unsorted.push(handler) : sorted[idx] = handler;
			});

			handlers[command] = unsorted.concat(sorted);

		});

	}
	
	/**
	 * Provides a queue that can run schedule jobs, respecting concurrency
	 * 
	 * @param {object} [opts]
	 * Options to configure "concurrency" and "interval"
	 * 
	 * @param {number} [opts.concurrency=10]
	 * The number of concurrent tasks that are allowed to be run in parallel
	 * 
	 * @param {number} [opts.interval=100]
	 * The time in milliseconds that we will check for queue updates
	 * 
	 * @param {function} cb
	 * A callback that will be called with the current task once it is
	 * ready to be executed
	 * 
	 * @return {object}
	 * The queue manager object
	 */
	static queue(opts, cb) {
		
		// the queue that will be returned
		let q = {
			
			uid: Math.random(),
			
			// the interval id that the queue runs on
			id: setInterval(() => {
				
				// make sure the queue can execute
				if (q.running.length >= q.concurrency) return;
				
				// run tasks
				q.tasks.forEach(function (task) {
					
					// make sure the task is allowed to run
					if (q.running.length >= q.concurrency) return;
					if (task.running) return;
					if (task.time > new Date().getTime()) return;
										
					// if we got until here, the task qualifies for execution
					task.running = true;
					q.running.push(task);
					
					// run the queue listeners to start processing the task
					cb(task.task, (err) => {
						
						if (err) console.log('Error while processing queued task:', err);
						
						// remove the task
						q.running.splice(q.running.indexOf(task), 1);
						q.tasks.splice(q.tasks.indexOf(task), 1);
						
					});
					
				});
				
			}, opts && opts.interval ? opts.interval : 1000),
			
			// the configured concurrency
			concurrency: opts && opts.concurrency ? opts.concurrency : 10,
			
			// queued tasks
			tasks: [],
			
			// running tasks
			running: [],
			
			// schedule a task
			schedule: (offset, task) => {
				q.tasks.push({ time: new Date().getTime() + offset, task: task, running: false });
			},
			
			// stop the queue
			kill: () => {
				clearInterval(q.id);
				q.tasks = [];
			}
			
		};
		
		return q;
	}
	
}

module.exports = SMTPUtil;
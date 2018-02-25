// Library to communicate with a Horizon server
var StellarSdk = require('stellar-sdk');
// Date and time manipulator (ISO 6801 UTC)
var Moment = require('moment');
// Node.js File System interaction module
var FileSystem = require('fs');
// Non-blocking PostgreSQL client for Node.js
var Postgres = require('pg');
// CLI helper (with argument parser)
var Meow = require('meow');

// Create the help string and set the flags
var cli = Meow(`
	Usage: snapshot.js <flags>
	
	Flags:
		--test, -t:	Run the script on testnet, if false, run on livenet (default: false)
		--local, -l:	Connect to a local horizon instance, if false, use SDF's (default: false)
		--database, -d:	PostgreSQL connection string (default: "postgresql://stellar@localhost:5432/core")
			You can check more info here: https://www.postgresql.org/docs/current/static/libpq-connect.html#id-1.7.3.8.3.6
		--horizon, -h:	Horizon URL to connect if the "local" flag is set (default: "http://localhost:8000")
		--pool, -p:	Public address ID of the pool (default: "GCCD6AJOYZCUAQLX32ZJF2MKFFAUJ53PVCFQI3RHWKL3V47QYE2BNAUT")
		--key, -k:	Format of key for a voter data pair to mark a donation (default: "lumenaut.net donation%")
	
	Example:
		snapshot.js -t true -l true -d postgresql://stellar@localhost:5432/testcore -h http://localhost:8001 -k "lumenaut.net donation%" -p GCFXD4OBX4TZ5GGBWIXLIJHTU2Z6OWVPYYU44QSKCCU7P2RGFOOHTEST
`, {
	flags: {
		test: {
			type: 'boolean',
			alias: 't',
			default: false
		},
		local: {
			type: 'boolean',
			alias: 'l',
			default: false
		},
		database: {
			type: 'string',
			alias: 'd',
			default: 'postgresql://stellar@localhost:5432/core'
			//default: 'postgresql://stellar@localhost:5432/testcore'
		},
		horizon: {
			type: 'string',
			alias: 'h',
			default: 'http://localhost:8000'
		},
		pool: {
			type: 'string',
			alias: 'p',
			default: 'GCCD6AJOYZCUAQLX32ZJF2MKFFAUJ53PVCFQI3RHWKL3V47QYE2BNAUT'
		},
		key: {
			type: 'string',
			alias: 'k',
			default: 'lumenaut.net donation%'
		}
	}
});
// Make sure no flag is an array (keep only the last value)
for (let k in cli.flags) {
	if (Array.isArray(cli.flags[k])) {
		cli.flags[k] = cli.flags[k][cli.flags[k].length-1];
	}
}
// Editable from the command line arguments (do not use cli in the actual code)
var test = cli.flags.test;
var local = cli.flags.local;
var dbConnString = cli.flags.database;
var horizon = cli.flags.horizon;
var poolID = cli.flags.pool;
var donationKey = cli.flags.key;

// Constants
var SDF_HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
var SDF_HORIZON_LIVENET = 'https://horizon.stellar.org';
var FED_URL = 'https://fed.network/inflation/';
var PGQUERY = "SELECT accounts.accountid, balance, dataname, datavalue FROM accounts LEFT JOIN accountdata ON accountdata.accountid = accounts.accountid AND dataname LIKE $1 WHERE inflationdest = $2";

// Client connection to the core database (if local)
var db;
// Connection to the horizon server
var server;
// Function to stop the operations stream
var stopStream;
// Inflation operation (used to get the effects)
var operation;
// Total amount of inflation (in stroops) the pool received
var amount;
// Moment of the inflation operation (UTC)
var moment;
// Pool's balance
var balance;
// Voters balances {VOTER_ID: Balance}
var voters = new Map();
// Voters data pairs {VOTER_ID: {donation_key: pct%account, ...}}
var data = new Map();

// START!
main();

// Script main entrypoint
function main() {
	// Set the network passprhase string
	if (test) StellarSdk.Network.useTestNetwork();
	else StellarSdk.Network.usePublicNetwork();

	// Select the correct horizon server
	if (local) {
		// 
		server = new StellarSdk.Server(horizon, {allowHttp: true});
		// Create a client connection to the PostreSQL database
		db = new Postgres.Client({connectionString: dbConnString});
		// Wait until DB is connected to start the Event Source stream
		db.connect()
			.then(() => stopStream = server.operations().cursor('now')
				.stream({onmessage: handleOperation, onerror: err}))
			.catch(kill);
	} else {
		// Select the correct Horizon server from SDF
		if (test) server = new StellarSdk.Server(SDF_HORIZON_TESTNET);
		else server = new StellarSdk.Server(SDF_HORIZON_LIVENET);
		// Start the stream and save the stop function
		stopStream = server.operations()
			.cursor('now')
			.stream({onmessage: handleOperation, onerror: err});
	}
	console.log('---START-STREAM---');
}

// Handle the Operation event from the Event Source
function handleOperation(op) {
	//console.log('handleOp - op.type: ' + op.type + ' PT: ' + op.paging_token);
	// In case the stream was already stopped, ignore
	if (stopStream == undefined) return;
	
	// Ignore the operation if not inflation
	if (op.type_i != 9) {
		return;
	}
	
	// We got the inflation operation!
	operation = op;
	console.log('---INFLATION---');
	console.log('Operation type: ' + op.type);
	console.log('Created at: ' + op.created_at);
	console.log('Paging Token: ' + op.paging_token);
	console.log('From: ' + op.source_account);
	console.log('Transaction Hash: ' + op.transaction_hash);
	
	// Close the event source
	if (stopStream) {
		console.log('---END-STREAM---');
		stopStream();
		stopStream = undefined;
	}
	
	let p = [];
	// Add getting the voters to the promises array
	if (local) p.push(db.query(PGQUERY, [donationKey, poolID]).then(promiseVotersDB));
	else p.push(httpGet(FED_URL + poolID).then(promiseVotersFed));
	// Add getting the inflation amount to the promises array
	p.push(server.effects().forOperation(op.id).limit(200).call().then(promiseAmount));
	
	// Aggregate the promises (then if all resolve, catch if any reject)
	Promise.all(p)
		.then((v) => {
			// End the connection with the DB
			if (db) db.end();
			// Everything ok, log and start writing the file
			console.log(v[0] + ' voters updated');
			console.log(v[1] + ' stroops received');
			return promiseWrite('voters.json', JSON.stringify(snapshot(), null, 2))
				.then((res) => console.log(res));
		})
		.catch((e) => {
			// Something went wrong, dump whatever we have
			console.log('### VOTERS MAP CONSOLE DUMP ###');
			console.log(JSON.stringify(snapshot(), null, 2));
			kill(e);
		});
}

// Promise to check all effects and update the inflation amount
function promiseAmount(effects){
	return new Promise((resolve, reject) => {
		// The list of effects is inside the 'records' field
		let records;
		if (effects.hasOwnProperty('records')) records = effects['records'];
		else reject('No "records" property in the received effects result');
		
		console.log('Checking ' + records.length + ' effects for inflation amount...');
		// Find the amount of XLM the pool received
		for (let i in records) {
			let ef = records[i];
			
			if (ef.type_i == 2 && ef.account == poolID){
				console.log(ef.amount + ' of XLM credited to ' + poolID);
				// Save the inflation received in stroops
				amount = Number(ef.amount) * 10000000;
				resolve(amount);
			}
		}
		// Didn't find any credit effect for this pool
		reject('No credit effect (type_i == 2) found for ' + poolID);
	});
}

// Promise to fill the voters Map with balances and donation data (from DB rows)
function promiseVotersDB(res) {
	return new Promise((resolve, reject) => {
		console.log(res.rows.length + ' rows returned from the DB query');
		// Loop all the rows create the balances and data pairs
		for (let i in res.rows) {
			let row = res.rows[i];
			// Update the pool's balance (and allow it to be included as a voter)
			if (row['accountid'] == poolID) balance = Number(row['balance']);
			
			// Update the voter's balance
			voters.set(row['accountid'], Number(row['balance']));
			
			// Update the voter's data, if any
			if (row['datavalue'] !== null) {
				// Returns string of the decoded value (U+FFFD if not printable)
				let value = Buffer.from(row['datavalue'], 'base64').toString();
				
				if (data.has(row['accountid'])) {
					data.get(row['accountid']).set(row['dataname'], value);
				} else {
					data.set(row['accountid'], new Map());
					data.get(row['accountid']).set(row['dataname'], value);
				}
			}
		}
		// Finished, resolve the promise (no reject needed)
		resolve(voters.size);
	});
}

// Promise to fill the voters Map with balances only (from fed.network JSON)
function promiseVotersFed(httpBody) {
	return new Promise((resolve, reject) => {
		// Reject if can't parse or no 'entries' property
		let res, entries;
		try {
			res = JSON.parse(httpBody);
			if (res.hasOwnProperty('entries')) entries = res['entries'];
			else reject('No "entries" property in the received http body');
		} catch (e) {
			reject(e);
		}
		
		console.log(res['entries'].length + ' entries in the fed JSON (' + httpBody.length + ' bytes)');
		// Fed.network don't provide the data pairs
		for (let i in entries) {
			// Update the pool's balance (and allow it to be included as a voter)
			if (entries[i]['account'] == poolID) balance = entries[i]['balance'];
		
			// Update the voter's balance
			voters.set(entries[i]['account'], entries[i]['balance']);
		}
		// Finished, resolve the promise
		resolve(voters.size);
	});
}

// Wrap fs.writeFile inside a promise
function promiseWrite(file, data, options) {
	return new Promise((resolve, reject) => {
		FileSystem.writeFile(file, data, options, (e) => {
			if (e) reject(e);
			else resolve('Successfuly saved ' + file.toString());
		});
	});
}

// Wrap simple HTTP GET inside a promise
// from https://www.tomas-dvorak.cz/posts/nodejs-request-without-dependencies/
function httpGet(url) {
	return new Promise((resolve, reject) => {
		// Select http or https module, depending on url
		let lib = url.startsWith('https') ? require('https') : require('http');
		let req = lib.get(url, (res) => {
			// Handle HTTP errors
			if (res.statusCode !== 200) {
				reject(new Error('HTTP error code: ' + res.statusCode));
			}
			// Temporary data holder
			let body = [];
			// On every content chunk, push it to the data array
			res.on('data', (chunk) => body.push(chunk));
			// We are done, resolve promise with the joined chunks
			res.on('end', () => resolve(body.join('')));
		});
		// Handle connection errors of the request
		req.on('error', (e) => reject(e));
	});
}

// Snapshot format we want to print:
// {
//     "inflationdest" : <Pool ID>,
//     "balance" : <Integer>,
//     "inflation" : <Integer>,
//     "created" : <YYYY-MM-DDTHH:mm:ssZ>
//     "expires" : <Moment(created+7days)>,
//     "operation" : <Integer>,
//     "txhash" : <Hex String>,
//     "entries" : [
//     {
//         "account" : <Voter ID>,
//         "balance" : <Integer>,
//         "data" : null | [
//         {
//             "dataname" : <String>,
//             "datavalue" : <String>
//         }, ... ]
//     }, ... ]
// }
function snapshot() {
	let snap = {};
	// Pool data
	snap.inflationdest = poolID;
	snap.balance = balance;
	// Inflation operation data
	snap.inflation = amount;
	snap.created = operation.created_at;
	snap.expires = Moment.utc(snap.created)
		.add(7, 'days')
		.format();
	snap.operation = operation.id;
	snap.txhash = operation.transaction_hash;
	// Voters list (entries array)
	snap.entries = [];
	
	// Append voters to the entries array
	let id, vit = voters.keys();
	while ((id = vit.next().value) !== undefined) {
		snap.entries.push({
			account: id,
			balance: voters.get(id)
		});
		
		// Append data array to this voter (or null)
		let i = snap.entries.length - 1;
		if (data.has(id)) {
			snap.entries[i].data = [];
			let k, dit = data.get(id).keys();
			while ((k = dit.next().value) !== undefined) {
				snap.entries[i].data.push({
					dataname: k,
					datavalue: data.get(id).get(k)
				});
			}
		} else {
			snap.entries[i].data = null;
		}
	}
	
	// Object created (easy to print with JSON.stringify)
	return snap;
}

// Function to show fatal errors
function kill(error) {
	console.log('### FATAL ###');
	err(error);
	// TODO: Fix the error treatment, use throws and exit cleanly
	process.exit();
}

// Function to highlight the errors in a stupidly visible way
function err(error) {
	console.log('### ERROR ###');
	console.log(error);
	console.log('#############');
}


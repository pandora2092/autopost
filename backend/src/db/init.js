const { getDb } = require('./client');
const { initSchema } = require('./schema');

initSchema();
console.log('Database initialized.');

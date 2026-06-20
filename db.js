const { createClient } = require('@libsql/client');

let client = null;

function getDb() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error('TURSO_DATABASE_URL environment variable is not set');
    }

    client = createClient({
      url,
      authToken,
    });
  }
  return client;
}

module.exports = { getDb };

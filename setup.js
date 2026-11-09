// npm run setup  ->  wipes and rebuilds the database with fresh sample data.
const config = require('./config');
const { buildDatabase } = require('./db-setup');

buildDatabase(config).catch((err) => {
  console.error('\nSetup failed:', err.message);
  if (/password authentication/i.test(err.message)) {
    console.error('-> Wrong password. Set DATABASE_URL, or $env:PGPASSWORD="..."');
  }
  process.exit(1);
});

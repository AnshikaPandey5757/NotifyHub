// Database connection settings.
//
// DEPLOYED (Render + Neon): set the DATABASE_URL environment variable to the
// connection string Neon gives you. Nothing else needs changing.
//
// LOCAL: either set DATABASE_URL too (you can point it at Neon!), or use the
// fields below for a PostgreSQL installed on your PC. Set the password with
// $env:PGPASSWORD="..." instead of typing it here, so it never goes to GitHub.
const url = process.env.DATABASE_URL;

if (url) {
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  module.exports = { connectionString: url, ssl: isLocal ? false : true, usesUrl: true };
} else {
  module.exports = {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'notifyhub',
    usesUrl: false,
  };
}



const config = {
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  pgDatabase: process.env.PGDATABASE,
  pgUser: process.env.PGUSER,
  pgPassword: process.env.PGPASSWORD,
  pgHost: process.env.PGHOST,
  pgPort: process.env.PGPORT
}

export default config;

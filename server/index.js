import config from './config';
import express from 'express';
import redis from 'redis';
import bodyParser from 'body-parser';
import cors from 'cors';
import pkg from 'pg';


// Express
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Postgres
const { Pool } = pkg;
const pgClient = new Pool({
  database: config.pgDatabase,
  user: config.pgUser,
  password: config.pgPassword,
  host: config.pgHost,
  port: config.pgPort 
});
pgClient.on('error', () => console.log('Lost PG connection'));
pgClient.query('CREATE TABLE IF NOT EXISTS values (number INT)')
  .catch(err => console.error(err));

// Redis
const redisClient = redis.createClient({
  host: config.redisHost,
  port: config.redisPort,
  retry_strategy: () => 1000
});
const redisPublisher = redisClient.duplicate();


app.get('/', (req, res) => {
  res.send('Hi');
});
app.get('/values/all', async (req, res) => {
  const values = await pgClient.query('SELECT * from values');
  res.sendStatus(values.rows);
});
app.get('/values/current', async (req, res) => {
  redisClient.hgetall('values', (err, values) => {
    res.send(values);
  });
});
app.post('/values', async (req, res) => {
  const index = req.body.index;
  if (parseInt(index) > 40) {
    return res.status(422).send('Index too high');
  }
  redisClient.hset('values', index, 'Nothing yet!');
  redisPublisher.publish('insert', index);
  pgClient.query('INSERT INTO values(number) VALUES($1)', [index]);

  res.send({ working: true });
});

app.listen(5000, err => {
  console.log('Listening on port 5000...');
});


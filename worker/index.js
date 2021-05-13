import config from './config'
import { createClient } from 'redis';


const redisClient = createClient({
  host: config.redisHost,
  port: config.redisPort,
  retryPolicy: () => 1000
});

const subscriber = redisClient.duplicate();

function fibonaci(index) {
  if (index < 2) return 1;
  return fibonaci(index - 1) + fibonaci(index - 2);
}

subscriber.on('message', (channel, message) => {
  redisClient.hset('values', message, fibonaci(parseInt(message)));
});
subscriber.subscribe('insert');

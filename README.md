# fibonacci-docker-app

Example app using multiple containers in Docker

### Table of Contents

* [Introduction](#introduction)
* [Containers](#containers)
* [Implementation](#implementation)
* [Run](#run)
* [Docker Compose](#docker-compose)
* [Deployment](#deployment)


## Introduction

This is an overly complex Fibonacci app that shows usage of multi-container Docker workflow.
A user can access a frontend that allows them to view different Fibonacci indexes. All the
indexes requested by the user will be shown to the user.

## Containers

* [React front end](/client)
* [Express backend](/server)
* [Redis worker](/worker)
* [Nginx reverse proxy](/nginx)

## Implementation

1. A user provides an index to the frontend.
2. A post request is made the Express server.

    ```js
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
    ```
 3. The index is sent to the redis server and the Redis publisher publishes an `insert` event.
 4. The index is saved into a Postgres database.
 5. A Redis worker is listening for these `insert` events. When an event is receieved, it
    calculates the fibonacci index and stores it in Redis under `values`.
    
    ```js
     function fibonaci(index) {
      if (index < 2) return 1;
      return fibonaci(index - 1) + fibonaci(index - 2);
    }

    subscriber.on('message', (channel, message) => {
      redisClient.hset('values', message, fibonaci(parseInt(message)));
    });
    subscriber.subscribe('insert');
    ```

6. The client makes a request for all the values calculated and indexes seen so far.
   The indexes are fetched from the Postgres database and the values are fetched from
   the Redis server.
     
     ```js
     app.get('/values/all', async (req, res) => {
       const values = await pgClient.query('SELECT * from values');
       res.send(values.rows);
     });
     app.get('/values/current', async (req, res) => {
       redisClient.hgetall('values', (err, values) => {
         res.send(values);
       });
     });
     ```
#### Frontend code

```js
class Fib extends Component {
  state = {
    seenIndexes: [],
    values: {},
    index: ''
  };

  componentDidMount() {
    this.fetchValues();
    this.fetchIndexes();
  }

  async fetchValues() {
    const values = await axios.get('/api/values/current');
    this.setState({values: values.data});
  }

  async fetchIndexes() {
    const seenIndexes = await axios.get('/api/values/all');
    this.setState({ seenIndexes: seenIndexes.data });
  }

  handleSubmit = async (event) => {
    event.preventDefault();
    await axios.post('/api/values', {
      index: this.state.index
    });
    this.setState({ index: '' });
  }

  renderSeenIndexes() {
    return this.state.seenIndexes
      .map(({ number }) => number)
      .join(', ');
  }

  renderValues() {
    const entries = [];
    for (let key in this.state.values) {
      entries.push(
        <div key={key}>
          For index {key} I calculated {this.state.values[key]}
        </div>
      )
    }
    return entries;
  }

  render() {
    return (
      <div>
        <form onSubmit={this.handleSubmit}>
          <div className="input-label">
            <label htmlFor="index-input">Enter your index: </label>
          </div>
          <div className="index-form">
            <input id="index-input"
              value={this.state.index}
              onChange={event => this.setState({ index: event.target.value }) }/>
            <button>Submit</button>
          </div>
        </form>

        <h3>Indexes I have seen:</h3>
        <p>{this.renderSeenIndexes()}</p>

        <h3>Calculated values:</h3>
        <div>{this.renderValues()}</div>
      </div>
    );
  }
}
```

#### Nginx

Nginx serves as a reverse proxy, redirecting traffic ether to the create-react-app server
or to the Express server. `/api` requests are redirected to the Express server (`api`), while all others
are redirected to the create-react-app (`client`). There is an endpoint `/sockjs-node` configured
to handle WebSocket requests. The is needed for the brwoser auto-reload.

```nginx
upstream client {
  server client:3000;
}

upstream api {
  server api:5000;
}

server {
  listen 80;

  location / {
    proxy_pass http://client;
  }

  location /sockjs-node {
    proxy_pass http://client;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
  }

  location /api {
    rewrite /api/(.*) /$1 break;
    proxy_pass http://api;
  }
}
```


## Run

```bash
$ docker-compose up
```

You can access the client at `http://localhost:4040` (which is mapped to port 80 on the Nginx container.
The API server is also exposed for debugging purposes, so you can access the API from the host machine
at port 5000. Postgres is exposed via [Adminer](https://www.adminer.org) at port 8080. Postgres username
and password are shown in the `docker-compose.yml` file

## Docker Compose

```yaml
version: '3.8'
services:
  nginx:
    build:
      context: ./nginx
      dockerfile: Dockerfile.dev
    restart: always
    ports:
      - '4040:80'

  client:
    build:
      context: ./client
      dockerfile: Dockerfile.dev
    volumes:
      - /app/node_modules
      - ./client:/app

  api:
    build:
      context: ./server
      dockerfile: Dockerfile.dev
    volumes:
      - /app/node_modules
      - ./server:/app
    ports:
      - '5000:5000'
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
      PGDATABASE: postgres
      PGUSER: postgres
      PGPASSWORD: supersecret
      PGHOST: postgres
      PGPORT: 5432

  worker:
    build:
      context: ./worker
      dockerfile: Dockerfile.dev
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379

  postgres:
    image: postgres:13
    restart: always
    environment:
      POSTGRES_PASSWORD: supersecret

  adminer:
    image: adminer
    restart: always
    ports:
      - 8080:8080

  redis:
    image: redis:6
```

## Shutdown

```bash
$ docker-compose down
```

## Deploy

![deploy-flow](/docs/docker-deploy-flow.png)

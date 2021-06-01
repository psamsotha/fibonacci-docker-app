# fibonacci-docker-app

Example app using multiple containers in Docker

### Table of Contents

* [Introduction](#introduction)
* [Containers](#containers)
* [Implementation](#implementation)
* [Run](#run)
* [Docker Compose](#docker-compose)
* [Shutdown](#shutdown)
* [Deployment](#deployment)
    * [AWS](#aws)
        * [ElasticBeanstalk](#elasticebeanstalk)
        * [RDS Postgres](#rds-postgres)
        * [ElastiCache Redis](#elasticache-redis)
        * [Security Groups](#security-groups)
        * [Travis IAM User](#travis-iam-user)
        * [ElasticBeanstalk Environment Variables](#elasticbeanstalk-environment-variables)
        * [Bastion Host](#bastion-host)
        * [Dockerrun.aws.json file](#dockerrun.aws.json-file)
    * [Travis CI](#travis-ci)
        * [Build and Deply Scripts](#build-and-deploy-scripts)
        * [Travis Environment Variables](#travis-environment-variables)
* [Cleanup Resources](#cleanup-resuorces)
* [TODO](#todo)



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


## Deployment

![deploy-flow](/docs/docker-deploy-flow.png)


## AWS

For this application, we will be deploying to AWS ElasticBeanstalk using a multi-container
Docker platform. For this deployment method, AWS will actually be using ECS to manage containers.


### ElasticBeanstalk

The first thing we need to do is to create an ElasticBeanstalk application. After the application has been created, we need to create an Environment for the application. After
the application is created, go to "Create a new environment" and use the following options:

1. Web server environment
2. Platform=Docker; Platform branch=Multi-container Docker; Platform version=default
3. Application code=Sample application
3. Configure more options:
    * Security -> Virtual machine permission: select EC2 key pair for bastion host access (not required)
    * Network -> Select a VPC and a subnet
4. Create environment


### RDS Postgres

For the database, we will be using Postgres with the help of AWS RDS. Go the RDS home pagfe
and create a new database. Use the following options:

1. Standard create
2. Postgres
3. Free tier
4. Settings:
    * DB instance identifier: fibonacci-db
    * Credentials settings:
        * Master username: postgres
        * Master password: your-p@ssw0rd
5. DB instance class: db.t2.micro (important, unless you want to incure charges)
6. Connectivity: unless you know what you're doing, the default setting should be OK
7. Additional configuration:
    Initial database name: fibonacci
8. Create database


### ElastiCache Redis

For distibuted caching, we will be using Redis with the help of AWS ElastiCache. Go to the ElastiCache home page and click "Create". Use the following options:

1. Redis
2. Deselect "Cluster Mode enabled" if selected
3. Redis settings:
    * Name: fibonacci-redis
    * Node type: t2 -> cache.t2.micro (0.5GB) (impotant unless you don't mind incurring charges)
    * Number of replicas: 0
4. Backup: deselect "Enable automatic backups"
5. Create


### Security Groups

By default, our services will not able able to communicate with each other. We need to add these services to a custom security group. Security groups are like firewalls to our AWS resource instances. We can configure inbound and outbound rules. When you create an ElasticBeanstalk environment, a default security groups is created that allows incoming HTTP
traffic. But we also need to allow incoming traffic to our Postgres and Redis databases. We're also going to create a Bastion host, so we will also create a security group just for the Bastion host (this is optional).

Go to VPC home page and go to Security Groups and create a new security group. When creating the security group, just leave all the defaults. We will need to access this group when we add the rules, so it needs to be created first. After the group is created, select it from the list of security groups. The click "Edit Inbout rules"

Add the following Inbound rules:

* Type=Custom TCP; Port range=6379; Source=Custom-<your-sg-name>; Desc=Redis access
* Type=Custom TCP; Port range=5432; Source=Custom-<your-sg-name>; Desc=Postgres access
* (Options) Type=SHH; Port range=22; Source=Custom-<yout-sg-group>; Desc=SHH from bastion host

Now we need to add this security group to all of our resources

#### ElasticBeanstalk security group configuration

Go to the environment you created earlier and select "Configuration" from the left side bar. The Edit the "Instances". In "EC2 security groups", select <name-of-sg-group>. You should now have _two_ selected, the default and the one you just created. The clikc "Apply"

#### RDS security group configuration

Go the RDS database you created earlier and click "Modify". In "Connectivity", select the security group the you created. The click "Continue"

#### ElastiCache security group configuration

Go the the ElastiCache and select the Redis instance you created earlier. The click "Actions" -> "Modify". In "VPC Security Groups", edit it and select the security group you created. Then click "Modify".


### Travis IAM User

In order for Travis CI to be able to deploy our application to ElastiBeanstalk, it will need an access key. So we will create an IAM user just for Travis. Go to the IAM home page in the AWS console and select Users. Create a new User and do the following:

1. Create a user name, for example: fibonacci-travis
2. Select (_only_) "Programmatic accees"
3. Click "Next:Permission"
4. Select "Attach existing policies directly"
5. Search for "ElasticBeanstalk" and select "AdministratorAccess-AWSElasticBeanstalk".
6. Click "Next:Tags"
7. Click "Next:Review"
8. Click "Create user"
9. You will now have access to the access and secret key. You will need to either download this file or copy and paste the secret key somewhere. This is the only time you will have access to the secret key.
10. Click close

### ElasticBeanstalk Environment Variables

The last thing we need to do in our AWS resource creation step is to add some environment variables to ElasticBeanstalk. These environment variables will be accessed by our applications. The environment variables will be accessible to all containers in the environemt.

Go to the ElasticBeanstalk environment you created and go to "Configuration". Then "Edit" the "Software". Add the followig environment variables:

* `PGDATABASE` - the "Initial database name" you created in [RDS Postgres](#rds-postgres)
* `PGHOST` - you will need to go to RDS and select the database you created. And then go to "Connectivity & security" and copy the "Endpoint"
* `PGPASSWORD` - the password you created in [RDS Postgres](#rds-postgres)
* `PGPORT` - 5432 (the default Postgres port)
* `PGUSER` - postgres (or what ever usename you used in [RDS Postgres](#rds-postgres))
* `REDIS_HOST` - you will need to go to ElastiCache and select the Redis instance you created and copy the "Primary Endpoint". The port should be excluded from this value.
* `REDIS_PORT` - 6379 (the default Redis port)

### Bastion Host

This step is optional. By default, your ElasticBeanstalk EC2 instance will not have a public IP address. If you want to use a [Bastion Host](https://en.wikipedia.org/wiki/Bastion_host) to access all the services for debugging or any other needs, you can create an EC2 Bastion host.

Go to EC2 in the AWS console and click "Launch instances". Use the following options:

1. Amazon Linux 2
2. t2.micro
3. Click "Next: Configure Instance Details"
4. In Networking, make sure the VPC you are using is selected
5. Click "Next: Add Storage"
6. Click "Next: Tags"
7. Click "Next: Configure Security Group"
8. The default security group allows SSH access from anywhere. If you just want access allowed from your IP, you can select "My IP" from "Source".
9. Click "Review and Launch"
10. Click "Lauch"
11. In the "Select an existing key pair" select a key pair that you have or create a new one
12. Your instance is now created.

#### Adding Bastion host to the security group

One last thing we need to do is add the Bastion host to the security group. Remember when we created the security group, we stated that access was allowed to services from the security group (as opposed to listing indiviual IP addresses, which could change).

Go to the EC2 console and select the Bastion host instance. Click "Actions" -> "Security" -> "Change security groups". Then add the security group in "Associated security groups".

#### SSH Agent

To access the private ElasticBeanstalk instance, the easiest way is to use the SSH-Agent. This way you don't have to copy your private key to your Bastion host (which is not a good idea). On your local machine, edit the `~/.ssh/config` file

```bash
$ nano ~/.ssh/config

Host Bastion
    Hostname ec2-<publicip>.<region>.compute.amazonaws.com
    User ec2-user
    Port 22

Host EBInstance
    Hostname  <privateip>
    Host ec2-user
    Port 22
    ProxyCommand ssh -W %h:%p Bastion
```

The `Hostname` in the `Bastion` will be the Public IPv4 DNS address of your Bastion host. You can get this from the EC2 console. The `Hostname` of the `EBInstance` will the private IP address of your ElasticBeanstalk instance. This can also be obtained from the EC2 console.

Now from your local machine, run the SSH agent and add your key

```bash
$ ssh-agent -s
$ ssh-add -k <path-to-your-key>
$ ssh-add -l
```

Now you can access the Bastion host and the private ElasticBeanstalk instance

```bash
$ ssh -A Bastion
[ec2-user@ip-172-31-20-168 ~]$ ssh ec2-user@<privateip>
```

### Dockerrun.aws.json file

The last thing we need to do for AWS is to create a `Dockerrun.aws.json` file. These are basically ECS Task Definitions. It will tell ECS how to create our containers. We will list the images that Travis will create and tell ECS how to link them

```json
{
  "AWSEBDockerrunVersion": 2,
  "containerDefinitions": [
    {
      "name": "fibonacci-client",
      "image": "psamsotha/fibonacci-client",
      "hostname": "client",
      "essential": false,
      "memory": 128
    },
    {
      "name": "fibonacci-server",
      "image": "psamsotha/fibonacci-server",
      "hostname": "api",
      "essential": false,
      "memory": 125
    },
    {
      "name": "fibonacci-worker",
      "image": "psamsotha/fibonacci-worker",
      "hostname": "worker",
      "essential": false,
      "memory": 128
    },
    {
      "name": "fibonacci-nginx",
      "image": "psamsotha/fibonacci-nginx",
      "hostname": "nginx",
      "essential": true,
      "portMappings": [
        {
          "hostPort": 80,
          "containerPort": 80
        }
      ],
      "links": ["fibonacci-client", "fibonacci-server"],
      "memory": 128
    }
  ]
}
```

**See:**

* [Dockerrun.aws.json v2](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/create_deploy_docker_v2config.html#create_deploy_docker_v2config_dockerrun)
* [ECS: Task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)



## Travis CI

When we push our commits to GitHub, Travis CI will clone our repo and run the scripts in our `.travis.yml` file. Travis will first run our tests, and then build the Docker images and push them up to Docker Hub. When that is complete, Travis will deploy our application to ElasticBeanstalk, and EB will look for the existence of our `Dockerrun.aws.json` file and use that to create our containers.

### Build and Deply Scripts

```yaml
sudo: required
services:
  - docker

before_install:
  - docker build -t psamsotha/react-test -f ./client/Dockerfile.dev ./client

script:
  - docker run psamsotha/react-test yarn run test -- --watchAll=false --coverage

after_success:
  - docker build -t psamsotha/fibonacci-client ./client
  - docker build -t psamsotha/fibonacci-nginx ./nginx
  - docker build -t psamsotha/fibonacci-server ./server
  - docker build -t psamsotha/fibonacci-worker ./worker
  - echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin
  - docker push psamsotha/fibonacci-client
  - docker push psamsotha/fibonacci-nginx
  - docker push psamsotha/fibonacci-server
  - docker push psamsotha/fibonacci-worker

deploy:
  provider: elasticbeanstalk
  region: "us-west-2"
  app: "fibonacci-docker-app"
  env: "fibonacci-docker-env"
  bucket_name: "elasticbeanstalk-us-west-2-557623108041"
  bucket_path: "fibonacci-docker-app"
  on:
    branch: "main"
  access_key_id: "$AWS_ACCESS_KEY_ID"
  secret_access_key: "$AWS_SECRET_ACCESS_KEY"
```

### Travis Environment Variables

We need to add a few environment variables so that Travis will be able to push our images up to Docker Hub and deploy our application to ElasticBeanstalk. In Travis, select the repository of the app and go to "Settings". Add the following environment variables:

* `DOCKER_USER` - your Docker Hub username
* `DOCKER_PASS` - your Docker Hub password
* `AWS_ACCESS_KEY_ID` - the AWS access key if of `fibonacci-travis` (or whatever user you created in [Travis IAM User](#travis-iam-user))
* `AWS_SECRET_ACCESS_KEY` - the AWS secret access key of `fibonacci-travis` (or whatever user you created in [Travis IAM User](#travis-iam-user))


    * [AWS](#aws)
        * [ElasticBeanstalk](#elasticebeanstalk)
        * [RDS Postgres](#rds-postgres)
        * [ElastiCache Redis](#elasticache-redis)
        * [Security Groups](#security-groups)
        * [Travis IAM User](#travis-iam-user)
        * [ElasticBeanstalk Environment Variables](#elasticbeanstalk-environment-variables)
        * [Bastion Host](#bastion-host)
        * [Dockerrun.aws.json file](#dockerrun.aws.json-file)
        
    * [Travis CI](#travis-ci)
        * [Build and Deply Scripts](#build-and-deploy-scripts)
        * [Travis Environment Variables](#travis-environment-variables)

## Cleanup Resources

To avoid charges, the following resources need to be cleaned up

* ElasticBeanstalk environment
* Bastion host
* RDS Postgres
* ElastiCache Redis
* Security group
* Travis IAM user

## TODO

* Make Docker Hub repositories private and update Dockerrun.aws.json configuratio to include "authentication"

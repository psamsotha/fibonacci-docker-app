FROM node:alpine3.13
WORKDIR /app
COPY package*.json ./
RUN yarn install
COPY . .
CMD ["yarn", "run", "start"]

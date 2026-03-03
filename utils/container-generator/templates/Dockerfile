FROM ghcr.io/zerobias-org/devops-nodejs-image:22-alpine
LABEL org.opencontainers.image.source https://github.com/zerobias-org/collectorbot

RUN apk update && apk add ca-certificates openssl git && rm -rf /var/cache/apk/*

WORKDIR /opt/collectorbot
COPY dist ./dist
COPY node_modules ./node_modules
COPY package.json .
COPY *.yml .
COPY .npmrc .

EXPOSE 8888
CMD ["node", "dist/run.js"]

# FROM 961260934100.dkr.ecr.us-east-1.amazonaws.com/devops-nodejs-image:16-alpine
FROM ghcr.io/auditmation/devops-nodejs-image:16-alpine
LABEL org.opencontainers.image.source https://github.com/auditlogic/collectorbot

RUN apk update && apk add ca-certificates openssl git && rm -rf /var/cache/apk/*

WORKDIR /opt/collectorbot
COPY dist ./dist
COPY node_modules ./node_modules
COPY package.json .
COPY *.yml .
COPY .npmrc .

EXPOSE 8888
CMD ["node", "dist/run.js"]

# TODO verify: pin the base image by digest (node:24-alpine@sha256:<digest>).
# I could not look the digest up here. Keep the major version in sync with ci.yml.
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Unprivileged user. The numeric id must match runAsUser in k8s/deployment.yaml.
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app

# Only what the service needs. See .dockerignore for what stays out (.env, .git, k8s/...).
COPY package.json ./
COPY src ./src

USER 10001:10001

# Application port only. The debug port 9229 is gone.
EXPOSE 3000

CMD ["node", "src/server.js"]
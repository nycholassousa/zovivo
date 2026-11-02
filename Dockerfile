# Zovivo's image. It has no dependencies at run time and writes nothing, so
# Zoia's read-only root is no trouble: Node and the source are all it needs.
FROM node:26-alpine

WORKDIR /addon
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
  HOME=/tmp \
  TMPDIR=/tmp

USER node
CMD ["node", "src/index.js"]

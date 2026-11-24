# Outline for Railway: the official image pinned by digest, plus a pre-deploy step
# that waits for the databases, sets the Bucket CORS rule and creates the
# workspace and its first admin before the public port serves.
ARG OUTLINE_IMAGE=outlinewiki/outline:1.13.0@sha256:4583bb244dbb4464d8a632c75044d3b2f9fe44382b6a4b84d97995f473b823e4
FROM ${OUTLINE_IMAGE}

COPY --chown=nodejs:nodejs --chmod=0755 railway/ /opt/outline/railway/

# Image default command (node build/server/index.js); SERVICES selects web or worker.

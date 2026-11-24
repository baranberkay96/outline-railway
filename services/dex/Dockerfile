# Dex: small OpenID Connect provider that gives Outline an e-mail + password login.
# Upstream image pinned by digest; we only add htpasswd (bcrypt) and our start script.
ARG DEX_IMAGE=dexidp/dex:v2.46.1-alpine@sha256:65b72ca0f4b0bf6d4ada84ec21da8851782563404ac7b8f926923d27ceced9ab
FROM ${DEX_IMAGE}

USER root
RUN apk add --no-cache apache2-utils
COPY --chmod=0755 railway-dex.sh /usr/local/bin/railway-dex.sh
USER dex:dex

ENTRYPOINT ["/usr/local/bin/railway-dex.sh"]

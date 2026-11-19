# Build the high-volume message-cache persistence worker in Rust.
FROM rust:1.86-bookworm AS rust-build
WORKDIR /build
COPY rust/message-cache ./rust/message-cache
RUN cargo build --manifest-path rust/message-cache/Cargo.toml --release

# Install Node production dependencies with the native build libraries required
# by the existing Canvas package.
FROM node:22.22.1-bookworm-slim AS node-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22.22.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
    libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node-deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p native/bin
COPY --from=rust-build /build/rust/message-cache/target/release/jt-message-cache ./native/bin/jt-message-cache
RUN chmod 755 ./native/bin/jt-message-cache
EXPOSE 10000
CMD ["node", "index.js"]

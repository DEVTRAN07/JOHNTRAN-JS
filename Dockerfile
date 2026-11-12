# Dockerfile cho Render/Koyeb (free) — deploy bot 24/7
FROM node:22-slim

# yt-dlp NIGHTLY (bản thường xuyên fix chống chặn YouTube hơn bản ổn định)
# + ffmpeg (xử lý video/nhạc) + thư viện cho canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl python3 python3-pip \
    ffmpeg \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    fonts-dejavu-core \
    ca-certificates \
    && pip3 install --break-system-packages -U --pre yt-dlp \
    && ffmpeg -hide_banner -version >/dev/null \
    && rm -rf /var/lib/apt/lists/* && yt-dlp --version

WORKDIR /app
# copy package.json + vendor TRƯỚC để npm ci tìm thấy zalo-client (file:vendor/zalo-client)
COPY package*.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev
COPY . .

# Koyeb/Render/Northflank inject PORT — health server + panel tự mở đúng port đó.
# PORT=8000 là mặc định nếu nền tảng không inject (Northflank đọc từ EXPOSE).
ENV NODE_ENV=production
ENV TZ=Asia/Ho_Chi_Minh
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV PORT=8000
EXPOSE 8000

CMD ["node", "index.js"]

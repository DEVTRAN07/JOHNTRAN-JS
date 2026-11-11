const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const logger = require("../utils/logger");

const DEFAULT_TTL = {
  sticker: 86400000,
  image: 604800000,
  audio: 259200000,
  video: 86400000,
};

const VALID_TYPES = Object.keys(DEFAULT_TTL);

function envTTL(type) {
  const raw = process.env["MEDIA_CACHE_TTL_" + type.toUpperCase()];
  // .env.example documents TTL values in seconds; convert to internal milliseconds.
  const seconds = raw == null ? NaN : Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : DEFAULT_TTL[type] || 86400000;
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function normalizeType(type) {
  const t = String(type || "").toLowerCase();
  return VALID_TYPES.includes(t) ? t : "image";
}

function hmacSign(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmacSign("AWS4" + secretKey, dateStamp);
  const kRegion = hmacSign(kDate, region);
  const kService = hmacSign(kRegion, service);
  return hmacSign(kService, "aws4_request");
}

function encodeRfc3986(value) {
  return encodeURIComponent(value);
}

function canonicalQuery(params) {
  const keys = Object.keys(params).sort();
  return keys.map(function (k) {
    return encodeRfc3986(k) + "=" + encodeRfc3986(String(params[k]));
  }).join("&");
}

class R2Client {
  constructor({ accountId, accessKeyId, secretAccessKey, bucketName, publicUrl }) {
    this.accountId = accountId;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.bucketName = bucketName;
    this.publicUrl = publicUrl || "";
    this.endpoint = "https://" + accountId + ".r2.cloudflarestorage.com";
    this.region = "auto";
    this.service = "s3";
  }

  objectUrl(key) {
    return this.endpoint + "/" + encodeURIComponent(this.bucketName) + "/" + encodeURIComponent(key);
  }

  _isoDate(date) {
    date = date || new Date();
    return date.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  }

  _dateStamp(date) {
    return this._isoDate(date).slice(0, 8);
  }

  _signHeaders(request, date) {
    const dateStamp = this._dateStamp(date);
    const amzDate = this._isoDate(date);
    const host = new URL(this.objectUrl(request.key)).host;
    const payloadHash = request.payloadHash || "UNSIGNED-PAYLOAD";

    const headers = {
      host: host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };

    const signed = ["host", "x-amz-content-sha256", "x-amz-date"];
    const canonicalHeaders = signed.map(function (k) {
      return k + ":" + headers[k] + "\n";
    }).join("");
    const canonicalRequest = [
      request.method,
      "/" + encodeURIComponent(this.bucketName) + "/" + encodeURIComponent(request.key),
      "",
      canonicalHeaders,
      signed.join(";"),
      payloadHash,
    ].join("\n");

    const credentialScope = dateStamp + "/" + this.region + "/" + this.service + "/aws4_request";
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = getSigningKey(this.secretAccessKey, dateStamp, this.region, this.service);
    const signature = hmacSign(signingKey, stringToSign).toString("hex");

    const authHeader =
      "AWS4-HMAC-SHA256 " +
      "Credential=" + this.accessKeyId + "/" + credentialScope + ", " +
      "SignedHeaders=" + signed.join(";") + ", " +
      "Signature=" + signature;

    headers["authorization"] = authHeader;
    return headers;
  }

  _presignGet(key, expiresSeconds, date) {
    date = date || new Date();
    const dateStamp = this._dateStamp(date);
    const amzDate = this._isoDate(date);
    const host = new URL(this.objectUrl(key)).host;
    const credentialScope = dateStamp + "/" + this.region + "/" + this.service + "/aws4_request";

    const params = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": this.accessKeyId + "/" + credentialScope,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": Math.floor(expiresSeconds),
      "X-Amz-SignedHeaders": "host",
    };

    const canonicalQueryString = canonicalQuery(params);
    const canonicalHeaders = "host:" + host + "\n";
    const canonicalRequest = [
      "GET",
      "/" + encodeURIComponent(this.bucketName) + "/" + encodeURIComponent(key),
      canonicalQueryString,
      canonicalHeaders,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = getSigningKey(this.secretAccessKey, dateStamp, this.region, this.service);
    const signature = hmacSign(signingKey, stringToSign).toString("hex");

    params["X-Amz-Signature"] = signature;
    return this.objectUrl(key) + "?" + canonicalQuery(params);
  }

  async request({ method, key, body, contentType, expires }) {
    const url = this.objectUrl(key);
    const headers = {};

    if (body != null) {
      headers["content-type"] = contentType || "application/octet-stream";
    }

    const date = new Date();
    const signHeaders = this._signHeaders(
      { method: method, key: key, payloadHash: body != null ? sha256Hex(body) : "UNSIGNED-PAYLOAD" },
      date
    );
    Object.assign(headers, signHeaders);

    const config = {
      method: method,
      url: url,
      headers: headers,
      responseType: "arraybuffer",
      validateStatus: function (status) { return status >= 200 && status < 300; },
    };
    if (body != null) config.data = body;

    const res = await axios(config);
    return {
      status: res.status,
      data: res.data ? Buffer.from(res.data) : Buffer.alloc(0),
      headers: res.headers || {},
    };
  }

  getUrl(key, expiresSeconds) {
    return this._presignGet(key, expiresSeconds);
  }
}

class MediaCache {
  constructor(options) {
    options = options || {};
    this.cacheDir = options.cacheDir || path.join(__dirname, "assets", "cache", "media");
    this.ttls = {};
    for (var i = 0; i < VALID_TYPES.length; i++) {
      var type = VALID_TYPES[i];
      this.ttls[type] = options.ttl && options.ttl[type] != null ? options.ttl[type] : envTTL(type);
    }
    this.defaultTtl = options.defaultTtl || 86400000;

    this.r2 = null;
    const r2Configured =
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME;
    if (r2Configured) {
      this.r2 = new R2Client({
        accountId: process.env.R2_ACCOUNT_ID,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucketName: process.env.R2_BUCKET_NAME,
        publicUrl: process.env.R2_PUBLIC_URL || "",
      });
      logger.log("MediaCache: R2 storage duoc cau hinh (" + process.env.R2_BUCKET_NAME + ")", "info");
    } else {
      logger.log("MediaCache: chua cau hinh R2, su dung dia cache luu tru", "info");
    }

    this._stats = {
      uploads: 0,
      hits: 0,
      misses: 0,
      invalidations: 0,
      bytes: 0,
      localFiles: 0,
      r2Configured: !!this.r2,
    };

    fs.mkdirSync(this.cacheDir, { recursive: true });
    for (var j = 0; j < VALID_TYPES.length; j++) {
      fs.mkdirSync(path.join(this.cacheDir, VALID_TYPES[j]), { recursive: true });
    }
    this._refreshLocalFileCount();
  }

  _typeDir(type) {
    return path.join(this.cacheDir, normalizeType(type));
  }

  _blobPath(type, key) {
    return path.join(this._typeDir(type), key);
  }

  _metaPath(type, key) {
    return this._blobPath(type, key) + ".meta.json";
  }

  _makeKey(buffer, metadata) {
    const metaStr = JSON.stringify(metadata || {});
    return sha256Hex(Buffer.concat([Buffer.from(buffer), Buffer.from("|metadata|"), Buffer.from(metaStr)]));
  }

  _readMeta(type, key) {
    try {
      const raw = fs.readFileSync(this._metaPath(type, key), "utf8");
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  _writeMeta(type, key, meta) {
    fs.writeFileSync(this._metaPath(type, key), JSON.stringify(meta), "utf8");
  }

  _removeMeta(type, key) {
    try { fs.unlinkSync(this._metaPath(type, key)); } catch (e) { /* ignore */ }
  }

  _isExpired(meta) {
    if (!meta || typeof meta !== "object") return true;
    const expiresAt = Number(meta.expiresAt || 0);
    return expiresAt > 0 && Date.now() > expiresAt;
  }

  _removeLocal(type, key) {
    for (const file of [this._blobPath(type, key), this._metaPath(type, key)]) {
      try { fs.unlinkSync(file); } catch (e) { /* already removed */ }
    }
  }

  _readLocal(type, key) {
    const blobPath = this._blobPath(type, key);
    const meta = this._readMeta(type, key);
    if (!meta || this._isExpired(meta)) {
      this._removeLocal(type, key);
      return null;
    }
    try {
      const stat = fs.statSync(blobPath);
      if (!stat.isFile() || stat.size <= 0 || Number(meta.size) !== stat.size) {
        this._removeLocal(type, key);
        return null;
      }
      const buffer = fs.readFileSync(blobPath);
      if (!buffer.length || (meta.sha256 && meta.sha256 !== sha256Hex(buffer))) {
        this._removeLocal(type, key);
        return null;
      }
      return { buffer, meta };
    } catch (e) {
      this._removeLocal(type, key);
      return null;
    }
  }

  _refreshLocalFileCount() {
    let count = 0;
    try {
      for (var k = 0; k < VALID_TYPES.length; k++) {
        const type = VALID_TYPES[k];
        const dir = path.join(this.cacheDir, type);
        if (!fs.existsSync(dir)) continue;
        const names = fs.readdirSync(dir);
        for (var m = 0; m < names.length; m++) {
          if (!names[m].endsWith(".meta.json")) count++;
        }
      }
    } catch (e) { /* ignore */ }
    this._stats.localFiles = count;
  }

  async upload(buffer, type, metadata) {
    metadata = metadata || {};
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    const t = normalizeType(type);
    const key = this._makeKey(buffer, metadata);
    const ttl = this.ttls[t] || this.defaultTtl;
    const expiresAt = Date.now() + ttl;
    const contentType = (metadata.contentType) || this._contentTypeFor(t);

    const localEntry = this._readLocal(t, key);
    if (localEntry) {
      this._stats.hits++;
      this._refreshLocalFileCount();
      return { url: this.getUrl(key), key: key, cached: true };
    }

    if (this.r2) {
      try {
        const res = await this.r2.request({ method: "GET", key: t + "/" + key });
        if (res.data && res.data.length > 0) {
          await this._writeLocal(t, key, buffer, metadata, ttl, contentType, expiresAt);
          this._stats.hits++;
          this._refreshLocalFileCount();
          return { url: this.getUrl(key), key: key, cached: true };
        }
      } catch (err) {
        if (!(err.response && err.response.status === 404)) {
          logger.log("MediaCache: kiem tra R2 that bai: " + err.message, "warn");
        }
      }
    }

    await this._writeLocal(t, key, buffer, metadata, ttl, contentType, expiresAt);
    if (this.r2) {
      try {
        await this.r2.request({
          method: "PUT",
          key: t + "/" + key,
          body: buffer,
          contentType: contentType,
          metadata: { ...metadata, type: t, expiresAt: expiresAt, size: String(buffer.length), createdAt: String(Date.now()) },
        });
        this._stats.r2Uploads = (this._stats.r2Uploads || 0) + 1;
      } catch (err) {
        logger.log("MediaCache: upload R2 that bai (key=" + key + "): " + err.message, "warn");
      }
    }

    this._stats.uploads++;
    this._stats.bytes += buffer.length;
    this._refreshLocalFileCount();
    return { url: this.getUrl(key), key: key, cached: false };
  }

  async _writeLocal(type, key, buffer, metadata, ttl, contentType, expiresAt) {
    const dir = this._typeDir(type);
    fs.mkdirSync(dir, { recursive: true });
    const blobPath = this._blobPath(type, key);
    const metaPath = this._metaPath(type, key);
    const suffix = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
    const blobTemp = `${blobPath}.tmp-${suffix}`;
    const metaTemp = `${metaPath}.tmp-${suffix}`;
    const meta = {
      metadata: metadata,
      type: type,
      contentType: contentType,
      size: buffer.length,
      sha256: sha256Hex(buffer),
      createdAt: Date.now(),
      expiresAt: expiresAt,
    };
    try {
      fs.writeFileSync(blobTemp, buffer, { flag: "wx" });
      fs.writeFileSync(metaTemp, JSON.stringify(meta), { flag: "wx" });
      // Publish metadata first; an interrupted write is treated as a cache miss.
      fs.renameSync(metaTemp, metaPath);
      fs.renameSync(blobTemp, blobPath);
    } finally {
      try { fs.unlinkSync(blobTemp); } catch (e) { /* renamed or absent */ }
      try { fs.unlinkSync(metaTemp); } catch (e) { /* renamed or absent */ }
    }
  }

  _contentTypeFor(type) {
    switch (type) {
      case "sticker": return "image/webp";
      case "image": return "image/*";
      case "audio": return "audio/*";
      case "video": return "video/*";
      default: return "application/octet-stream";
    }
  }

  async get(key) {
    let foundType = null;
    for (var i = 0; i < VALID_TYPES.length; i++) {
      if (fs.existsSync(this._blobPath(VALID_TYPES[i], key))) {
        foundType = VALID_TYPES[i];
        break;
      }
    }

    if (foundType) {
      const local = this._readLocal(foundType, key);
      if (local) {
        this._stats.hits++;
        return { buffer: local.buffer, metadata: local.meta.metadata || {} };
      }
    }

    if (this.r2) {
      for (var i = 0; i < VALID_TYPES.length; i++) {
        const t = VALID_TYPES[i];
        try {
          const res = await this.r2.request({ method: "GET", key: t + "/" + key });
          if (res.data && res.data.length > 0) {
            const meta = this._parseR2Metadata(res.headers);
            if (!this._isExpired(meta)) {
              await this._writeLocal(t, key, res.data, meta.metadata, this.ttls[t] || this.defaultTtl, meta.contentType, meta.expiresAt);
              this._stats.hits++;
              return { buffer: res.data, metadata: meta.metadata || {} };
            }
          }
          break;
        } catch (err) {
          if (err.response && err.response.status === 404) continue;
          logger.log("MediaCache: get R2 that bai: " + err.message, "warn");
          break;
        }
      }
    }

    this._stats.misses++;
    return null;
  }

  _parseR2Metadata(headers) {
    const metadata = {};
    let contentType = "application/octet-stream";
    let expiresAt = 0;
    for (const [k, v] of Object.entries(headers || {})) {
      const lk = String(k).toLowerCase();
      if (lk === "content-type") contentType = v;
      else if (lk.startsWith("x-amz-meta-")) {
        const name = lk.slice("x-amz-meta-".length);
        if (name === "metadata") {
          try { metadata.metadata = JSON.parse(v); } catch (e) { metadata.metadata = {}; }
        } else if (name === "expires-at") expiresAt = Number(v) || 0;
        else if (name === "content-type") contentType = v;
      }
    }
    return { metadata: metadata.metadata || {}, contentType: contentType, expiresAt: expiresAt };
  }

  getUrl(key) {
    let foundType = null;
    for (var i = 0; i < VALID_TYPES.length; i++) {
      if (fs.existsSync(this._blobPath(VALID_TYPES[i], key))) {
        foundType = VALID_TYPES[i];
        break;
      }
    }

    if (this.r2) {
      const ttl = foundType ? (this.ttls[foundType] || this.defaultTtl) : this.defaultTtl;
      return this.r2.getUrl(key, Math.floor(ttl / 1000));
    }

    if (foundType) {
      return "file://" + this._blobPath(foundType, key);
    }
    return "file://" + this._blobPath("image", key);
  }

  async invalidate(key) {
    let removed = false;
    for (var i = 0; i < VALID_TYPES.length; i++) {
      const t = VALID_TYPES[i];
      const blob = this._blobPath(t, key);
      if (fs.existsSync(blob)) {
        try { fs.unlinkSync(blob); removed = true; } catch (e) {}
      }
      this._removeMeta(t, key);
    }
    if (this.r2) {
      for (var i = 0; i < VALID_TYPES.length; i++) {
        const t = VALID_TYPES[i];
        try {
          await this.r2.request({ method: "DELETE", key: t + "/" + key });
          removed = true;
        } catch (err) {
          if (!(err.response && err.response.status === 404)) {
            logger.log("MediaCache: invalidate R2 that bai: " + err.message, "warn");
          }
        }
      }
    }
    if (removed) this._stats.invalidations++;
    this._refreshLocalFileCount();
    return removed;
  }

  stats() {
    this._refreshLocalFileCount();
    const total = this._stats.hits + this._stats.misses;
    return {
      uploads: this._stats.uploads,
      hits: this._stats.hits,
      misses: this._stats.misses,
      hitRate: total > 0 ? (this._stats.hits / total) : 0,
      invalidations: this._stats.invalidations,
      bytes: this._stats.bytes,
      localFiles: this._stats.localFiles,
      r2Configured: this._stats.r2Configured,
      cacheDir: this.cacheDir,
      ttls: { ...this.ttls },
    };
  }
}

const mediaCache = new MediaCache();

module.exports = { MediaCache: MediaCache, mediaCache: mediaCache };

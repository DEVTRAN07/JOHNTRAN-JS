const { pooledAxios } = require("./pooledAxios");
const logger = require("../../utils/logger");
const { hostAllowed } = require("./index");

let installed = false;

function configuredServiceHosts() {
  const hosts = [];
  const services = global.config?.services || {};
  for (const value of Object.values(services)) {
    if (!value || typeof value !== "string") continue;
    try {
      hosts.push(new URL(value).hostname);
    } catch { /* bỏ qua URL không hợp lệ */ }
  }
  return hosts;
}

function blockedError(url, reason) {
  const error = new Error(`Bị chặn bởi chính sách bảo mật: ${reason}`);
  error.privacyBlocked = true;
  error.blockedUrl = url;
  return error;
}

function installAxiosGuard() {
  if (installed) return;
  installed = true;

  pooledAxios.interceptors.request.use(
    (config) => {
      let url = config.url || "";
      if (/^https?:\/\//i.test(url) === false && config.baseURL) {
        config.url = new URL(url.replace(/^\//, ""), config.baseURL).toString();
        url = config.url;
      }
      if (typeof url !== "string" || !url) return config;

      const guard = hostAllowed(url, global.config);
      if (guard.allowed) return config;

      const configured = configuredServiceHosts();
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch {
        return Promise.reject(blockedError(url, guard.reason));
      }
      if (configured.includes(host)) return config;

      logger.log(`[privacy] axios bị chặn: ${url.replace(/([?&])(st|e|sig|sign|token|key|secret|password)=[^&]*/gi, "$1$2=***")}`, "warn");
      return Promise.reject(blockedError(url, guard.reason));
    },
    (error) => Promise.reject(error)
  );
}

module.exports = { installAxiosGuard, pooledAxios };

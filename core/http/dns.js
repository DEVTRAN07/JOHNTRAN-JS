const https = require("https");

// Các bộ giải DNS-over-HTTPS công cộng: kết nối trực tiếp qua IP cứng,
// vì chính việc giải tên miền hệ thống (system DNS) là điểm thất bại.
// Không tra cứu IP của cloudflare-dns.com hay dns.google qua DNS hệ thống nữa.

const DOH_RESOLVERS = [
  { host: "cloudflare-dns.com", path: "/dns-query", ips: ["1.1.1.1", "1.0.0.1"] },
  { host: "dns.google", path: "/resolve", ips: ["8.8.8.8", "8.8.4.4"] }
];

// A DNS fallback should be much faster than the request it is recovering.
const TIMEOUT_MS = 3000;

// Truy vấn một bộ giải DoH qua một IP cứng.
// Trả về Promise chứa mảng các chuỗi IPv4, hoặc reject nếu IP này thất bại.
function queryDoh(resolver, hostname, signal) {
  return new Promise((resolve, reject) => {
    const url =
      resolver.path +
      "?name=" +
      encodeURIComponent(hostname) +
      "&type=A";

    const options = {
      hostname: resolver.ips[0],
      port: 443,
      path: url,
      method: "GET",
      headers: {
        Accept: "application/dns-json",
        Host: resolver.host
      },
      servername: resolver.host,
      timeout: TIMEOUT_MS,
      signal
    };

    const req = https.get(options, (resp) => {
      const chunks = [];

      // Chỉ chấp nhận mã trạng thái HTTP 2xx, các mã khác coi là thất bại của IP này.
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        resp.resume();
        return reject(new Error("HTTP " + resp.statusCode));
      }

      resp.on("data", (chunk) => chunks.push(chunk));
      resp.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString();
          const data = JSON.parse(body);

          // Status khác 0 (NOERROR) có nghĩa là không có câu trả lời hợp lệ,
          // ví dụ 3 = NXDOMAIN. Thoát bộ giải này, sang bộ giải tiếp theo.
          if (data.Status !== 0) {
            return reject(new Error("DoH status " + data.Status));
          }

          const ips = (data.Answer || [])
            .filter((ans) => ans.type === 1 && typeof ans.data === "string")
            .map((ans) => ans.data);

          if (ips.length === 0) {
            return reject(new Error("no A records"));
          }

          resolve(ips);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

// Thử từng bộ giải, từng IP cứng. Chỉ reject toàn bộ khi TẤT CẢ IP của TẤT CẢ
// bộ giải đều thất bại.
async function resolveWithDoH(hostname) {
  const controller = new AbortController();
  const attempts = DOH_RESOLVERS.flatMap(resolver =>
    resolver.ips.map(ip => queryDoh({ ...resolver, ips: [ip] }, hostname, controller.signal))
  );

  try {
    // Race all resolver IPs: one healthy DNS endpoint is enough. Serial
    // fallback used to block for 10s x 4 addresses during a DNS outage.
    return await Promise.any(attempts);
  } catch (error) {
    const reasons = Array.isArray(error?.errors) ? error.errors : [];
    throw reasons[0] || error || new Error("resolveWithDoH: all resolvers failed");
  } finally {
    // Cancel slower DNS requests once the first valid answer is known.
    controller.abort();
  }
}

module.exports = { resolveWithDoH };

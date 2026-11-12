import chalk from "chalk";
import { DateTime } from "luxon";
import axios from "axios";
import pkg from "../../../package.json";

// ===== Ngưỡng log: chỉ in debug khi config.logging_level = "debug" =====
declare global {
  namespace NodeJS {
    interface Global {
      config?: { logging_level?: string };
    }
  }
}

type LogLevel = "warn" | "error" | "info" | "debug" | string;

function isDebug(): boolean {
  return global.config?.logging_level === "debug" || process.env.DEBUG === "1";
}

const SECRET_PATTERNS: RegExp[] = [
  /([?&](?:st|e|sig|sign|token|key|apiKey|api_key|secret|password|client_secret|access_token|imei)=)[^&\s"']*/gi,
  /(Bearer\s+)[A-Za-z0-9._-]+/gi,
  /\b(AIza[0-9A-Za-z_-]{20,})/g
];

function redact(data: unknown): unknown {
  if (typeof data !== "string") return data;
  let output: string = data;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "$1***");
  }
  return output;
}

// Vùng in có thể thay thế (dùng cho QR code) — xoá nội dung cũ bằng ANSI
// thay vì console.clear() nên màn hình không bị giật khi npm run dev
let replaceableLines = 0;

function clearReplaceable(): void {
  if (replaceableLines <= 0) return;
  process.stdout.write(`\x1b[${replaceableLines}F`);
  process.stdout.write("\x1b[0J");
  replaceableLines = 0;
}

function printReplaceable(lines: string | string[]): void {
  clearReplaceable();
  const text = Array.isArray(lines) ? lines.join("\n") : String(lines);
  replaceableLines = text.split("\n").length;
  console.log(text);
}

async function printBanner(): Promise<void> {
  let newVersion: string | null = null;
  try {
    const response = await axios.get("https://raw.githubusercontent.com/DEVTRAN07/JOHNTRAN/refs/heads/main/package.json", {
      timeout: 10000
    });
    newVersion = response.data.version;
  } catch {
    // repo không truy cập được thì bỏ qua kiểm tra cập nhật, không được crash bot
  }
  const projectVersion = pkg.version;

// KHÔNG console.clear() ở đây — tránh màn hình giật khi nodemon restart
  const banner = chalk.cyanBright(`
     ██╗ ██████╗ ██╗  ██╗███╗   ██╗    ████████╗██████╗  █████╗ ███╗   ██╗
     ██║██╔═══██╗██║  ██║████╗  ██║    ╚══██╔══╝██╔══██╗██╔══██╗████╗  ██║
     ██║██║   ██║██║███████║██╔██╗ ██║       ██║   ██████╔╝███████║██╔██╗ ██║
 ██   ██║██║   ██║██╔══██║██║╚██╗██║       ██║   ██╔══██╗██╔══██╗██║╚██╗██║
 ╚█████╔╝╚██████╔╝██║  ██║██║ ╚████║       ██║   ██║  ██║██║  ██║██║ ╚██║
  ╚════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝       ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝`);

  console.log(banner);
  console.log(chalk.gray("═══════════════════════════════════════════════════════════════════"));
  console.log("» " + chalk.green("Version: ") + chalk.white(projectVersion));
  console.log("» " + chalk.green("Author : ") + chalk.white("John Tran"));
  console.log("» " + chalk.green("Github : ") + chalk.underline("https://github.com/DEVTRAN07/JOHNTRAN"));
  console.log(chalk.gray("═══════════════════════════════════════════════════════════════════\n"));
  if (newVersion && projectVersion !== newVersion) log(`New version: ${newVersion}\n`, "warn");
}

function getTimestamp(): string {
  const now = DateTime.now().setZone("Asia/Ho_Chi_Minh");
  return `[${now.toFormat("HH:mm:ss")}]`;
}

function log(data: unknown, option: LogLevel = "info"): void {
  const time = getTimestamp();
  const safeData = String(redact(String(data)));
  switch (option) {
    case "warn":
      console.log(chalk.bold.hex("#FFD700")(`${time} » `) + safeData);
      break;
    case "error":
      console.log(chalk.bold.hex("#FF0000")(`${time} » `) + safeData);
      break;
    case "info":
      console.log(chalk.bold.hex("#00BFFF")(`${time} » `) + safeData);
      break;
    case "debug":
      if (isDebug()) console.log(chalk.bold.hex("#888888")(`${time} » [DEBUG] `) + safeData);
      break;
    default:
      console.log(chalk.bold.hex("#00BFFF")(`${time} » `) + safeData);
  }
}

function logDebug(data: unknown): void {
  log(data, "debug");
}

export { log, logDebug, redact, printBanner, printReplaceable, clearReplaceable };

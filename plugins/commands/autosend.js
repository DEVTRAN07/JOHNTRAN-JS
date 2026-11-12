const fs = require("fs");
const path = require("path");
const { ThreadType } = require("zalo-client");
const { getBuffer: queuedGetBuffer } = require("../../core/runtime/queuedHttp");

let GIF_LIST = [];
try { GIF_LIST = require("../../assets/autosend.json"); } catch { GIF_LIST = []; } // 64 gif imgur
const TEMP_DIR = path.join(__dirname, "temp");

module.exports.config = {
  name: 'autosend',
  version: '2.0.0',
  role: 1,
  author: 'ᴶᴼᴴᴺ ᵀᴿᴬᴺ',
  description: 'Tự động gửi tin nhắn 1 tiếng/lần cho nhóm đã bật',
  category: "Tiện ích",
  usage: 'autosend [on|off|status|test]',
  cooldowns: 2
};

// Mỗi nhóm bật autosend nhận 1 tin/GIỜ — câu chữ THEO GIỜ CỐ ĐỊNH
// (6h câu gì, 7h câu gì...), không random. Giờ không có trong bảng
// (1-5h sáng) → bot im lặng cho yên.
const TICK_INTERVAL = 60 * 1000;     // quét mỗi phút
const INITIAL_DELAY = 5 * 1000;      // chờ bot ổn định sau khi bật

const HOURLY_MESSAGES = {
  0: "Khuya ròi, chúc ai còn thức một đêm an yên nhé🌙 Ngủ ngon cả nhà😴",
  6: "Chúc mọi người buổi sáng vui vẻ😉 Dậy sớm thành công rồi, cố lên nhé!💪",
  7: "Buổi sáng đầy năng lượng nhaa các bạn😙 Đi học đi làm thôi nào!",
  8: "Dậy đê ngủ như heo😒 Tính nướng tới bao giờ đây😠 Đi muộn giờ đó nha!",
  9: "Sáng năng suất rồi đó mọi người☕ Tập trung làm việc nào!",
  10: "Giờ làm việc chắc chắn rồi💼 Nhớ uống nước và nghỉ mắt nhé!",
  11: "Sắp đến giờ nghỉ trưa rồi🍱 Cố gắng lên nha!",
  12: "Chúc mọi người buổi trưa vui vẻ😋 Đừng bỏ bữa nhé!",
  13: "Nghỉ trưa xíu rồi bắt đầu buổi chiều nha😇",
  14: "Chúc mọi người buổi chiều vui vẻ🙌",
  15: "Buổi chiều đầy năng lượng😼 Chiều làm gì thì làm nào!",
  16: "Chiều rồi, xả stress thôi 🎉",
  17: "Hết giờ làm rồi về nhà thôi mọi người 😎",
  18: "Về nhà nhớ tắm rửa ăn uống nha 🚿🍚",
  19: "Tối rồi, nghỉ ngơi đi mọi người 🥱",
  20: "Tối nay có ai rảnh đi chơi hông nè? 😜",
  21: "Nhớ ăn tối đầy đủ nhé, giữ sức khỏe 💪",
  22: "Tối rồi, tắt điện thoại và đi ngủ thôi 📴🛌",
  23: "Khuya rùi ngủ ngon nhé các bạn😇 Ngủ sớm cho da đẹp dáng xinh nha💤"
};


// Tải 1 GIF ngẫu nhiên từ assets → file tạm. Lỗi mạng/hết gif → null
// (tin nhắn vẫn gửi, chỉ mất ảnh trang trí).
const GIF_TIMEOUT = 8000;

async function downloadRandomGif() {
  try {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
    const url = GIF_LIST[Math.floor(Math.random() * GIF_LIST.length)];
    const { buffer } = await queuedGetBuffer(url, { timeout: GIF_TIMEOUT, retries: 1 });
    if (!buffer || buffer.length < 64) return null;
    const filePath = path.join(TEMP_DIR, `autosend_${Date.now()}.gif`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    console.log("Autosend: không tải được gif (vẫn gửi tin nhắn):", err.message);
    return null;
  }
}

function cleanupGif(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* bỏ qua */ }
}

// Dọn gif tạm cũ sót lại (crash giữa lúc gửi)
try {
  if (fs.existsSync(TEMP_DIR)) {
    for (const f of fs.readdirSync(TEMP_DIR)) {
      if (f.startsWith("autosend_")) fs.unlinkSync(path.join(TEMP_DIR, f));
    }
  }
} catch { /* bỏ qua */ }

function hourMessage() {
  const hour = vnTime().getHours();
  return HOURLY_MESSAGES[hour] || null;
}

function autoMessage() {
  const body = hourMessage();
  if (!body) return null; // giờ im lặng → không gửi
  const t = vnTime();
  return `➢ 𝐍𝐨𝐭𝐢𝐟𝐢𝐜𝐚𝐭𝐢𝐨𝐧 🏆\n` +
    `➝ Bây Giờ Là: ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}\n` +
    `➝ Đây Là Tin Nhắn Tự Động)\n` +
    `━━━━━━━━━━\n` +
    `[ 𝗡𝗢̣̂𝗜 𝗗𝗨𝗡𝗚 ]  ${body}`;
}

// Khoá giờ đã gửi — "2026-10-13-14": mỗi nhóm chỉ nhận 1 tin/giờ
function hourKey() {
  const t = vnTime();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}-${String(t.getHours()).padStart(2, "0")}`;
}

function randomMessage() {
  // Chỉ dùng cho /autosend test — chọn 1 câu bất kỳ trong bảng theo giờ
  const pool = Object.values(HOURLY_MESSAGES);
  return pool[Math.floor(Math.random() * pool.length)];
}

function vnTime() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
}

// Thời gian còn lại tới lần gửi kế tiếp (cho lệnh status)
function nextSendText(lastHourKey) {
  if (lastHourKey === hourKey()) {
    return `đã gửi ${HOURLY_LABEL[localHour()] || "giờ này"} — lần kế tiếp: ${((localHour() + 1) % 24).toString().padStart(2, "0")}:00`;
  }
  return "sắp gửi (trong vài phút tới)";
}

const HOURLY_LABEL = {};
for (const h of Object.keys(HOURLY_MESSAGES)) HOURLY_LABEL[Number(h)] = `giờ ${h}`;
function localHour() { return vnTime().getHours(); }

module.exports.onLoad = async function ({ api, Threads }) {
  let sending = false; // chặn tick chồng nhau nếu tick trước chưa xong

  const autosend = async () => {
    if (sending) return;
    sending = true;
    try {
      // Phòng thủ: api mất kết nối thì bỏ qua tick này
      if (!api || typeof api.getAllGroups !== "function") return;

      const allGroups = await api.getAllGroups();
      const allBoxIDs = Object.keys(allGroups?.gridVerMap || {});
      if (allBoxIDs.length === 0) return;

      const now = Date.now();
      const currentHour = hourKey();
      let sentCount = 0;

      for (const groupId of allBoxIDs) {
        try {
          const thread = await Threads.getData(groupId);
          if (!thread?.data?.auto_send) continue;

          // Đã gửi giờ này rồi → bỏ qua (mỗi nhóm 1 tin/giờ)
          if (thread.data.auto_send_hour === currentHour) continue;

          const msg = autoMessage();
          if (!msg) continue; // giờ im lặng (1-5h sáng)

          // GIF trang trí từ assets — tải lỗi vẫn gửi text
          const gifPath = await downloadRandomGif();
          let sendOk = false;
          try {
            // Supabase row chỉ có id, KHÔNG có threadId — dùng thẳng groupId
            await api.sendMessage(
              { msg, ...(gifPath ? { attachments: [gifPath] } : {}) },
              groupId,
              ThreadType.Group
            );
            sendOk = true;
          } finally {
            cleanupGif(gifPath);
          }

          // GHI NHỚ giờ đã gửi — restart/deploy không gửi lại. Chỉ đánh dấu khi gửi thành công.
          if (sendOk) {
            thread.data.auto_send_hour = currentHour;
            await Threads.setData(groupId, thread.data);
            sentCount++;
          }
        } catch (err) {
          console.log(`Autosend: không gửi được tới nhóm ${groupId}: ${err.message}`);
        }
      }

      if (sentCount > 0) {
        console.log(`[AUTOSEND] ${new Date().toLocaleTimeString("vi-VN")} → đã gửi ${sentCount}/${allBoxIDs.length} nhóm`);
      }
    } catch (err) {
      console.log("Autosend tick lỗi (bỏ qua):", err.message);
    } finally {
      sending = false;
    }
  };

  // Tick đầu sau vài giây (bot vừa khởi động — nhóm nào tới giờ thì gửi ngay)
  setTimeout(() => {
    autosend();
    setInterval(autosend, TICK_INTERVAL).unref();
  }, INITIAL_DELAY);
};

module.exports.run = async ({ api, event, args, Threads }) => {
  const { threadId, type } = event;

  if (type === ThreadType.User) {
    return api.sendMessage({ msg: "❌ Lệnh chỉ có thể dùng trong nhóm", plain: true }, threadId, type);
  }

  const action = (args[0] || "").toLowerCase();

  // ===== TEST: gửi ngay 1 tin thử (không đợi 1 tiếng) =====
  if (action === "test" || action === "thu") {
    const current = (await Threads.getData(threadId)).data || {};
    if (!current.auto_send) {
      return api.sendMessage({ msg: "⚠️ Nhóm này chưa bật autosend. Gõ `autosend on` trước đã.", plain: true }, threadId, type);
    }
    try {
      await api.sendMessage({ msg: `📩 Tin thử autosend\nNếu thấy tin này là tính năng hoạt động.` }, threadId, type);
    } catch (error) {
      return api.sendMessage({ msg: `❌ Gửi thất bại: ${error.message}`, plain: true, ttl: 60000 }, threadId, type);
    }
    return;
  }

  const current = (await Threads.getData(threadId)).data || {};
  // getData trả SHALLOW copy: current.data và data phía dưới là CÙNG object —
  // ghi nhớ trạng thái cũ bằng flag riêng trước khi mutate.
  const wasEnabled = Boolean(current.auto_send);

  if (args[0] === "all") {
    return api.sendMessage(
      { msg: "❌ Không thể bật hàng loạt. Autosend chỉ bật/tắt trong từng nhóm: gõ `autosend on` / `autosend off` trong nhóm muốn điều khiển.", plain: true },
      threadId, type
    );
  }

  let status;
  if (action === "on" || action === "off") {
    status = action === "on";
  } else if (action === "status" || action === "stt") {
    return api.sendMessage(
      {
        msg: `📩 Autosend nhóm này: ${current.auto_send ? "ĐANG BẬT ✅" : "ĐANG TẮT ❌"}\n` +
             `⏱️ Nhịp gửi: 1 tiếng/lần — lần kế tiếp: ${nextSendText(current.auto_send_hour)}\n` +
             `Gõ autosend test để gửi tin thử ngay.`,
        plain: true,
        ttl: 120000
      },
      threadId, type
    );
  } else {
    status = !current.auto_send; // không tham số → toggle
  }

  const data = (await Threads.getData(threadId)).data || {};
  data.auto_send = status;
  if (status) {
    // Ghi giờ hiện tại là "đã gửi" — tick tự động sẽ gửi lại từ giờ kế tiếp
    data.auto_send_hour = hourKey();
  }
  await Threads.setData(threadId, data);

  // Bật xong gửi ngay 1 tin để người dùng THẤY nó chạy (lần đầu mỗi nhóm)
  if (status && !wasEnabled) {
    try {
      const msg = autoMessage() || `➢ 𝐍𝐨𝐭𝐢𝐟𝐢𝐜𝐚𝐭𝐢𝐨𝐧 🏆\n➝ Đây Là Tin Nhắn Tự Động (1 tiếng/lần)\n━━━━━━━━━━\n[ 𝗡𝗢̣̂𝗜 𝗗𝗨𝗡𝗚 ]  ${randomMessage()}`;
      const gifPath = await downloadRandomGif();
      try {
        await api.sendMessage(
          { msg, ...(gifPath ? { attachments: [gifPath] } : {}) },
          threadId,
          type
        );
      } finally {
        cleanupGif(gifPath);
      }
    } catch (error) {
      console.log("Autosend: gửi tin bật lập tức thất bại:", error.message);
    }
  }

  return api.sendMessage(
    { msg: `📩 Autosend đã được ${status ? "bật ✅ (1 tiếng/lần)" : "tắt ❌"} cho nhóm này.`, plain: true },
    threadId, type
  );
};

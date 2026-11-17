"use strict";

const engine = require("./noituEngine");
const dictionary = require("../runtime/services/games/ghepchuService");

const OPENING_PHRASES = Object.freeze([
  "học sinh", "bông hoa", "bầu trời", "trường học", "bóng đá",
  "nước biển", "cây xanh", "cá voi", "mưa rào", "bàn học"
]);

// Keys use the engine's accent-insensitive syllable normalization.
const REPLY_BANK = Object.freeze({
  sinh: ["sinh viên", "sinh nhật", "sinh học"],
  hoa: ["hoa hồng", "hoa quả", "hoa lá"],
  troi: ["trời xanh", "trời mưa", "trời nắng"],
  hoc: ["học tập", "học hành", "học phí"],
  da: ["đá bóng", "đá cầu", "đá quý"],
  bien: ["biển cả", "biển xanh", "biển đảo"],
  xanh: ["xanh mát", "xanh tươi", "xanh biếc"],
  voi: ["voi rừng", "voi con", "voi châu á"],
  rao: ["rào chắn", "rào cản", "rào giậu"],
  vien: ["viên chức", "viên mãn", "viên ngọc"],
  chuc: ["chức năng", "chức vụ", "chức trách"],
  nang: ["năng lượng", "năng suất", "năng động"],
  luong: ["lượng tử", "lượng giác"],
  tu: ["tử tế", "tử vi", "tử số"],
  te: ["tế nhị", "tế bào"],
  nhi: ["nhịp điệu", "nhị phân"],
  dieu: ["điệu nhạc", "điệu bộ", "điệu nhảy"],
  nhac: ["nhạc cụ", "nhạc sĩ"],
  cu: ["cụ thể", "cụ già"],
  the: ["thể thao", "thể chất"],
  thao: ["thao trường", "thao tác"],
  truong: ["trường đời", "trường học"],
  tap: ["tập trung", "tập luyện"],
  trung: ["trung tâm", "trung thực"],
  tam: ["tâm lý", "tâm hồn"],
  ly: ["lý tưởng", "lý do"],
  tuong: ["tưởng tượng", "tượng trưng"],
  thuc: ["thực tế", "thực hành"],
  hanh: ["hành động", "hành trình"],
  dong: ["đồng hồ", "đồng ý"]
});


const CURATED_MEANING_SOURCE = Object.freeze({
  "từ chức": "Rời bỏ chức vụ hoặc vị trí công tác mà mình đang đảm nhiệm.",
  "học sinh": "Người học tập tại trường phổ thông.",
  "bông hoa": "Bộ phận của cây, thường có màu sắc và hương thơm, dùng để sinh sản.",
  "bầu trời": "Khoảng không gian rộng lớn nhìn thấy phía trên mặt đất.",
  "trường học": "Nơi tổ chức việc dạy và học.",
  "bóng đá": "Môn thể thao mà hai đội dùng chân đưa bóng vào khung thành đối phương.",
  "nước biển": "Nước mặn tạo thành biển và đại dương.",
  "cây xanh": "Cây cối có lá chứa diệp lục và thường có màu xanh.",
  "cá voi": "Động vật có vú sống ở biển, có thân hình lớn.",
  "mưa rào": "Cơn mưa thường đến nhanh, hạt mưa lớn và kéo dài không lâu.",
  "bàn học": "Chiếc bàn dùng để ngồi học hoặc làm việc.",
  "sinh viên": "Người đang theo học tại trường cao đẳng hoặc đại học.",
  "sinh nhật": "Ngày kỷ niệm ngày một người được sinh ra.",
  "sinh học": "Ngành khoa học nghiên cứu về sự sống và sinh vật.",
  "hoa hồng": "Loài hoa có cánh mềm, thường có gai ở thân và nhiều màu sắc.",
  "hoa quả": "Cách gọi chung các loại quả dùng làm thực phẩm.",
  "hoa lá": "Cây cỏ, hoa và lá nói chung.",
  "trời xanh": "Bầu trời có màu xanh khi thời tiết quang đãng.",
  "trời mưa": "Hiện tượng nước từ khí quyển rơi xuống mặt đất.",
  "trời nắng": "Thời tiết có ánh sáng và nhiệt từ Mặt Trời chiếu xuống.",
  "học tập": "Quá trình tiếp thu kiến thức và rèn luyện kỹ năng.",
  "học hành": "Việc học tập, trau dồi kiến thức.",
  "học phí": "Khoản tiền phải nộp cho cơ sở giáo dục để được học.",
  "đá bóng": "Hoạt động chơi bóng đá.",
  "đá cầu": "Môn thể thao dùng chân tâng và chuyền quả cầu.",
  "đá quý": "Khoáng vật hiếm có vẻ đẹp, thường dùng làm trang sức.",
  "biển cả": "Vùng biển rộng lớn.",
  "biển xanh": "Biển có màu xanh do ánh sáng và đặc điểm của nước biển.",
  "biển đảo": "Các vùng biển và đảo thuộc một khu vực.",
  "xanh mát": "Có màu xanh và tạo cảm giác dịu, dễ chịu.",
  "xanh tươi": "Có màu xanh non, tràn đầy sức sống.",
  "xanh biếc": "Có màu xanh đậm và trong.",
  "voi rừng": "Voi sống trong môi trường tự nhiên.",
  "voi con": "Voi còn nhỏ.",
  "voi châu á": "Loài voi sinh sống chủ yếu ở Nam Á và Đông Nam Á.",
  "rào chắn": "Vật hoặc kết cấu dùng để ngăn cách, bảo vệ.",
  "rào cản": "Điều gây trở ngại cho một hoạt động hoặc quá trình.",
  "rào giậu": "Hàng rào làm bằng cây, tre hoặc vật liệu khác để bao quanh.",
  "viên chức": "Công dân được tuyển dụng vào vị trí việc làm tại đơn vị sự nghiệp công lập.",
  "viên mãn": "Đầy đủ, trọn vẹn và đạt trạng thái như mong muốn.",
  "viên ngọc": "Viên đá quý có giá trị, thường được chế tác làm trang sức.",
  "chức năng": "Vai trò hoặc công dụng của một người, vật hay bộ phận.",
  "chức vụ": "Vị trí hoặc vai trò được giao trong một tổ chức.",
  "chức trách": "Nhiệm vụ và trách nhiệm gắn với một vị trí.",
  "năng lượng": "Đại lượng vật lý đặc trưng cho khả năng sinh công.",
  "năng suất": "Lượng sản phẩm hoặc kết quả tạo ra trong một đơn vị thời gian.",
  "năng động": "Chủ động, linh hoạt và tích cực trong hoạt động.",
  "lượng tử": "Một đơn vị rời rạc của đại lượng vật lý trong lý thuyết lượng tử.",
  "lượng giác": "Nhánh toán học nghiên cứu quan hệ giữa góc và cạnh của tam giác.",
  "tử tế": "Có cách cư xử tốt, biết quan tâm và tôn trọng người khác.",
  "tử vi": "Hình thức luận đoán vận mệnh dựa trên ngày giờ sinh theo quan niệm dân gian.",
  "tử số": "Số nằm ở phía trên của vạch phân số.",
  "tế nhị": "Khéo léo, ý tứ trong cách cư xử.",
  "tế bào": "Đơn vị cấu trúc và chức năng cơ bản của cơ thể sống.",
  "nhịp điệu": "Sự lặp lại có quy luật của âm thanh hoặc chuyển động.",
  "nhị phân": "Hệ đếm cơ số hai, chỉ sử dụng hai chữ số 0 và 1.",
  "điệu nhạc": "Giai điệu hoặc nét nhạc có đặc điểm riêng.",
  "điệu bộ": "Cử chỉ và dáng vẻ thể hiện qua hành động.",
  "điệu nhảy": "Chuỗi động tác cơ thể theo nhạc.",
  "nhạc cụ": "Dụng cụ dùng để tạo ra âm thanh trong âm nhạc.",
  "nhạc sĩ": "Người sáng tác hoặc hoạt động chuyên môn về âm nhạc.",
  "cụ thể": "Rõ ràng, xác định, không chung chung.",
  "cụ già": "Người đã cao tuổi.",
  "thể thao": "Hoạt động vận động có quy tắc nhằm rèn luyện sức khỏe hoặc thi đấu.",
  "thể chất": "Những đặc điểm và năng lực về cơ thể của con người.",
  "thao trường": "Nơi tổ chức luyện tập quân sự.",
  "thao tác": "Động tác hoặc cách thực hiện một công việc.",
  "trường đời": "Môi trường xã hội nơi con người trải nghiệm và học hỏi.",
  "tập trung": "Dồn sự chú ý hoặc nguồn lực vào một việc.",
  "tập luyện": "Thực hành lặp lại để nâng cao kỹ năng hoặc thể lực.",
  "trung tâm": "Phần hoặc điểm ở giữa; nơi tập trung hoạt động.",
  "trung thực": "Ngay thẳng, tôn trọng sự thật.",
  "tâm lý": "Những hiện tượng và quá trình diễn ra trong đời sống tinh thần.",
  "tâm hồn": "Đời sống tình cảm và tinh thần của con người.",
  "lý tưởng": "Mục tiêu cao đẹp mà con người hướng tới.",
  "lý do": "Điều giải thích nguyên nhân của một sự việc.",
  "tưởng tượng": "Tạo ra hình ảnh hoặc ý tưởng trong trí óc.",
  "tượng trưng": "Dùng hình ảnh hoặc sự vật để đại diện cho ý nghĩa khác.",
  "thực tế": "Những gì tồn tại hoặc diễn ra trong đời sống thực.",
  "thực hành": "Áp dụng kiến thức vào hoạt động hoặc công việc cụ thể.",
  "hành động": "Việc làm có chủ ý của con người.",
  "hành trình": "Quá trình di chuyển hoặc trải qua một chặng đường."
});

const CURATED_MEANINGS = Object.freeze(Object.fromEntries(
  Object.entries(CURATED_MEANING_SOURCE).map(([phrase, definition]) => [
    engine.normalizePhrase(phrase),
    definition
  ])
));

function getCuratedMeaning(value) {
  const phrase = engine.parsePhrase(value);
  if (!phrase) return null;
  const definition = CURATED_MEANINGS[phrase.normalized];
  return definition ? {
    answer: phrase.display,
    definition,
    dictionarySource: "Kho ngữ nghĩa JOHNTRAN",
    source: "curated"
  } : null;
}

async function getPhraseMeaning(value, options = {}) {
  const curated = getCuratedMeaning(value);
  if (curated) return curated;
  return dictionary.lookupVietnameseTerm(value, {
    ...options,
    timeoutMs: options.timeoutMs || 700
  });
}

function pickIndex(length, random = Math.random) {
  if (!length) return -1;
  return Math.max(0, Math.min(length - 1, Math.floor(random() * length)));
}

function chooseOpeningPhrase(random = Math.random) {
  return OPENING_PHRASES[pickIndex(OPENING_PHRASES.length, random)];
}

function chooseReply(session, random = Math.random) {
  const required = session?.currentPhrase?.last;
  if (!required) return null;
  const used = session.used || new Set();
  const candidates = (REPLY_BANK[required] || [])
    .map(engine.parsePhrase)
    .filter(Boolean)
    .filter(phrase => phrase.first === required && !used.has(phrase.normalized) && getCuratedMeaning(phrase.display));
  const index = pickIndex(candidates.length, random);
  return index < 0 ? null : candidates[index];
}

async function findDynamicReply(session, options = {}) {
  const display = String(session?.currentPhrase?.display || "");
  const prefix = display.trim().split(/\s+/).at(-1);
  if (!prefix) return null;

  const required = engine.normalizeSyllable(prefix);
  const used = session.used || new Set();
  const fetchSuggestions = options.fetchSuggestions || dictionary.fetchSuggestions;

  try {
    const suggestions = await fetchSuggestions(prefix, {
      getJson: options.getJson,
      timeoutMs: options.timeoutMs || 700,
      now: options.now
    });
    const candidates = [...new Set((Array.isArray(suggestions) ? suggestions : [])
      .map(engine.parsePhrase)
      .filter(Boolean)
      .filter(phrase => phrase.first === required && !used.has(phrase.normalized))
      .map(phrase => phrase.normalized))];

    const phrases = candidates
      .map(value => suggestions.find(item => engine.parsePhrase(item)?.normalized === value))
      .filter(Boolean);
    const index = pickIndex(phrases.length, options.random || Math.random);
    return index < 0 ? null : engine.parsePhrase(phrases[index]);
  } catch {
    return null;
  }
}

module.exports = {
  OPENING_PHRASES,
  REPLY_BANK,
  chooseOpeningPhrase,
  chooseReply,
  findDynamicReply,
  getCuratedMeaning,
  getPhraseMeaning,
  CURATED_MEANINGS
};

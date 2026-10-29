/*
 * CẤU HÌNH GAME — chỉnh tại đây (mở bằng Notepad, lưu lại dạng UTF-8 rồi tải lại trang).
 * Đổi cấu hình trong lúc đang có phiên dở: phiên hiện tại vẫn giữ bộ đề và kết quả đã chốt;
 * cấu hình mới áp dụng từ phiên sau.
 */
(function (root) {
  var config = {
    // Tiền tố khóa lưu trong localStorage. Toàn bộ trạng thái sự kiện nằm trong MỘT bản ghi "<tiền tố>:event".
    STORAGE_PREFIX: 'hq-halloween-v2',
    // Tiền tố của các bản cũ. Nếu còn dữ liệu bản cũ, game chặn bắt đầu cho tới khi BTC sao lưu và xác nhận.
    LEGACY_PREFIXES: ['hq-halloween-v1'],

    // Mã PIN mở công cụ kho quà / sao lưu / khởi tạo sự kiện trong bảng BTC.
    BTC_PIN: '3110',

    // Phân bố câu hỏi theo level (mỗi phiên). Tổng số câu = tổng "count".
    // difficulty: 'easy' (Dễ) | 'medium' (Trung bình) | 'hard' (Khó)
    LEVEL_PLAN: [
      { level: 1, difficulty: 'easy', count: 2 },
      { level: 2, difficulty: 'easy', count: 2 },
      { level: 3, difficulty: 'medium', count: 2 },
      { level: 4, difficulty: 'medium', count: 2 },
      { level: 5, difficulty: 'hard', count: 2 }
    ],

    // Tổng lượt quay theo số câu đúng: SPIN_TABLE[số câu đúng] = số lượt (không cộng dồn).
    SPIN_TABLE: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5],

    // DANH MỤC QUÀ CHÍNH THỨC (thứ tự = thứ tự ô trên vòng quay, theo chiều kim đồng hồ từ đỉnh).
    // weight = xác suất gốc (%, số nguyên, tổng đúng 100). stock = tồn kho ban đầu (null = không giới hạn).
    // Một lần trúng = một đơn vị tồn kho. stock chỉ áp dụng khi KHỞI TẠO sự kiện mới;
    // trong sự kiện, BTC cộng/trừ kho bằng công cụ trong bảng BTC.
    // name = chữ trên ô vòng quay, lịch sử và thống kê; revealName = chữ khi mở trúng ô (nếu khác name).
    PRIZES: [
      { id: 'bear', name: 'Gấu bông', icon: '🧸', weight: 1, stock: 3, isPrize: true, tier: 'legend', color: '#c98a1c' },
      { id: 'puzzle', name: 'Mảnh ghép', icon: '🧩', weight: 10, stock: 20, isPrize: true, tier: 'epic', color: '#7b2fbf' },
      { id: 'sticker', name: 'Sticker', icon: '⭐', weight: 10, stock: 20, isPrize: true, tier: 'rare', color: '#1d7fa6' },
      { id: 'candy', name: 'Kẹo', icon: '🍬', weight: 29, stock: 60, isPrize: true, tier: 'common', color: '#e8532b' },
      { id: 'nothing', name: 'Không quà', revealName: 'Chúc bạn may mắn lần sau!', icon: '👻', weight: 50, stock: null, isPrize: false, tier: 'none', color: '#2b1b3f' }
    ],

    // Phiên được cấp tổng cộng đúng 1 lượt: bốc trúng ô "from" thì đổi thành "to" nếu còn hàng;
    // nếu "to" hết hàng thì chọn một quà còn hàng theo trọng số gốc (không hiển thị cho người chơi).
    SINGLE_SPIN_SWAP: { from: 'nothing', to: 'candy' },

    // Phiên được cấp từ 2 lượt trở lên: tối đa bao nhiêu quà; đủ rồi thì các lượt sau là "Không quà".
    MULTI_SPIN_MAX_PRIZES: 2,

    // Khi trả lời sai, có tô xanh đáp án đúng hay không.
    REVEAL_CORRECT_ON_WRONG: true,

    // Thời gian hiệu ứng (mili giây).
    TIMING: {
      answerSuspense: 1300, // nháy đáp án đã chọn trước khi công bố
      spin: 2600, // thời gian vòng quay (bấm vào vòng quay để dừng nhanh)
      spinReduced: 700 // khi máy bật "giảm chuyển động"
    }
  };

  root.HQ_CONFIG = config;
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
})(typeof window !== 'undefined' ? window : globalThis);

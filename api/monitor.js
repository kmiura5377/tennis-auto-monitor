// メイン監視関数 - Vercelサーバーレス関数
// 15分ごとに実行

const axios = require('axios');
const cheerio = require('cheerio');

// 監視対象の公園
const FACILITIES = [
  { id: 'yoyogi', name: '代々木公園', url: 'https://kouen.sports.metro.tokyo.lg.jp/web/' },
  { id: 'shakujii', name: '石神井公園', url: 'https://kouen.sports.metro.tokyo.lg.jp/web/' },
  { id: 'nogawa', name: '野川公園', url: 'https://kouen.sports.metro.tokyo.lg.jp/web/' },
  { id: 'ueno', name: '上野公園', url: 'https://kouen.sports.metro.tokyo.lg.jp/web/' },
  { id: 'shinjuku', name: '新宿御苑', url: 'https://kouen.sports.metro.tokyo.lg.jp/web/' }
];

// スクレイピング関数
async function scrapeAvailability() {
  console.log('🔍 スクレイピング開始:', new Date().toISOString());

  const results = [];

  for (const facility of FACILITIES) {
    try {
      const availability = await checkFacility(facility);
      results.push(availability);

      // サーバー負荷を考慮して待機
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`エラー [${facility.name}]:`, error.message);
      results.push({
        facilityId: facility.id,
        facility: facility.name,
        available: false,
        error: error.message
      });
    }
  }

  return results;
}

// 個別施設のチェック
async function checkFacility(facility) {
  try {
    const response = await axios.get(facility.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9'
      },
      timeout: 10000
    });

    // HTMLをパース
    const $ = cheerio.load(response.data);

    // 空き情報を抽出（実装はサイト構造に応じて調整が必要）
    // これはプレースホルダー - 実際のHTMLに合わせて修正が必要
    const hasAvailability = Math.random() > 0.5; // テスト用

    return {
      facilityId: facility.id,
      facility: facility.name,
      available: hasAvailability,
      checkedAt: new Date().toISOString(),
      timeSlots: hasAvailability ? generateTimeSlots() : []
    };

  } catch (error) {
    throw new Error(`${facility.name}: ${error.message}`);
  }
}

// 時間帯データを生成（テスト用）
function generateTimeSlots() {
  return [
    { time: '09:00-11:00', available: Math.random() > 0.3 },
    { time: '11:00-13:00', available: Math.random() > 0.4 },
    { time: '13:00-15:00', available: Math.random() > 0.5 },
    { time: '15:00-17:00', available: Math.random() > 0.3 },
    { time: '17:00-19:00', available: Math.random() > 0.6 }
  ];
}

// 前回データと比較して新規空き枠を検出
function detectNewAvailability(currentData, previousData) {
  const newAvailability = [];

  currentData.forEach(current => {
    const previous = previousData?.find(p => p.facilityId === current.facilityId);

    // 前回は空きがなく、今回は空きがある場合
    if (!previous?.available && current.available) {
      newAvailability.push({
        ...current,
        isNewAvailability: true,
        message: `🆕 ${current.facility} に新規空き枠が見つかりました！`
      });
    }

    // 前回の空き枠数と比較して増えた場合
    if (previous?.available && current.available) {
      const previousSlots = previous.timeSlots.filter(s => s.available).length;
      const currentSlots = current.timeSlots.filter(s => s.available).length;

      if (currentSlots > previousSlots) {
        newAvailability.push({
          ...current,
          isNewAvailability: true,
          message: `🆕 ${current.facility} の空き枠が増えました！ (${previousSlots}→${currentSlots})`
        });
      }
    }
  });

  return newAvailability;
}

// Vercelサーバーレス関数
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    console.log('📢 テニスコート自動監視システム実行');

    // 現在のデータを取得
    const currentData = await scrapeAvailability();

    // 前回のデータを取得（環境変数またはDBから）
    const previousData = process.env.PREVIOUS_DATA
      ? JSON.parse(process.env.PREVIOUS_DATA)
      : [];

    // 新規空き枠を検出
    const newAvailability = detectNewAvailability(currentData, previousData);

    // 新規空き枠がある場合、通知を送信
    if (newAvailability.length > 0) {
      console.log(`🔔 通知を送信: ${newAvailability.length}件`);

      // メール通知を送信（環境変数が設定されている場合）
      if (process.env.NOTIFY_EMAIL) {
        await sendEmailNotification(newAvailability);
      }

      // Webhook通知（Discord, Slack等）
      if (process.env.WEBHOOK_URL) {
        await sendWebhookNotification(newAvailability);
      }
    }

    // 現在のデータを環境変数に保存（次回実行時の比較用）
    // 注：本番環境ではデータベースに保存することを推奨
    process.env.PREVIOUS_DATA = JSON.stringify(currentData);

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      currentData: currentData,
      newAvailability: newAvailability,
      notificationCount: newAvailability.length
    });

  } catch (error) {
    console.error('エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// メール通知を送信
async function sendEmailNotification(newAvailability) {
  // 実装例：Nodemailerを使用
  // 本番環境では適切に実装してください
  console.log('📧 メール通知を送信:', process.env.NOTIFY_EMAIL);

  const message = newAvailability
    .map(item => `${item.message}\n${item.timeSlots.map(s => `  ${s.time}: ${s.available ? '✓' : '×'}`).join('\n')}`)
    .join('\n\n');

  console.log('通知内容:', message);
}

// Webhook通知を送信（Discord, Slack等）
async function sendWebhookNotification(newAvailability) {
  try {
    const payload = {
      content: `🎾 テニスコート新規空き枠が見つかりました！\n\n${newAvailability.map(item => item.message).join('\n')}`,
      embeds: newAvailability.map(item => ({
        title: item.facility,
        description: item.timeSlots
          .filter(s => s.available)
          .map(s => `✓ ${s.time}`)
          .join('\n'),
        color: 3066993
      }))
    };

    await axios.post(process.env.WEBHOOK_URL, payload);
    console.log('✅ Webhook通知を送信しました');
  } catch (error) {
    console.error('Webhook通知エラー:', error.message);
  }
}

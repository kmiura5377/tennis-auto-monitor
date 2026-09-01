// テニスコート空き状況API（現在はダミーデータ。実際のスクレイピングは未実装）
// 月間カレンダー表示用に、日付ごとの空き枠データを返す

const FACILITIES = [
  { id: 'yoyogi', name: '代々木公園' },
  { id: 'shakujii', name: '石神井公園' },
  { id: 'nogawa', name: '野川公園' },
  { id: 'ueno', name: '上野公園' },
  { id: 'shinjuku', name: '新宿御苑' }
];

const TIME_SLOTS = ['09:00-11:00', '11:00-13:00', '13:00-15:00', '15:00-17:00', '17:00-19:00'];

// 日付+施設ごとに決定論的な擬似乱数を生成（同じ日は同じ結果になる）
function seededRandom(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = (Math.imul(31, h) + seedStr.charCodeAt(i)) | 0;
  }
  return function () {
    h = (Math.imul(h, 1664525) + 1013904223) | 0;
    return ((h >>> 0) % 10000) / 10000;
  };
}

function generateDayFacilityData(dateStr, facility) {
  const rand = seededRandom(`${dateStr}_${facility.id}`);
  const date = new Date(dateStr + 'T00:00:00');
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const baseChance = isWeekend ? 0.35 : 0.55;

  const timeSlots = TIME_SLOTS.map(time => ({
    time,
    available: rand() < baseChance
  }));

  return {
    facilityId: facility.id,
    facility: facility.name,
    timeSlots
  };
}

function generateMonthData(year, month) {
  const days = {};
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dateStr = date.toISOString().split('T')[0];
    days[dateStr] = FACILITIES.map(f => generateDayFacilityData(dateStr, f));
  }

  return days;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const now = new Date();
    const year = parseInt(req.query?.year, 10) || now.getFullYear();
    const month = req.query?.month !== undefined ? parseInt(req.query.month, 10) : now.getMonth();

    const days = generateMonthData(year, month);

    res.status(200).json({
      success: true,
      timestamp: now.toISOString(),
      year,
      month,
      facilities: FACILITIES,
      days,
      isDummyData: true
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

/* ============================================================
 * Vision (識牌) - vision.js
 * 用 Google Gemini API (免費 tier) 由相片識別麻雀牌
 * ============================================================ */

(function (global) {
  'use strict';

  const PROMPT = `你係一個麻雀牌識別助手。睇住呢張相,搵出所有可見嘅麻雀牌張。

請用以下標準寫法輸出 JSON,絕對唔好加任何 markdown / code fence / 解釋,直接返回 JSON 物件:

{
  "tiles": ["1m", "2m", "3m", ...],   // 手牌 (包食糊張),唔包已副露嘅碰/槓/吃
  "melds": [                            // 副露(碰/槓/吃);冇就空 array
    {"type": "pung", "tiles": ["E","E","E"]},
    {"type": "chi",  "tiles": ["1m","2m","3m"]},
    {"type": "kong", "tiles": ["5p","5p","5p","5p"]}
  ],
  "flowers": [],                        // 花/季牌
  "winning_tile": "9s",                 // 最尾食糊嗰隻;唔知就揀手牌最後一張
  "is_self_draw": false,                // 自摸?睇唔到就 false
  "confidence": "high"                  // high / medium / low
}

牌張 key:
  萬子 = 1m..9m
  筒子 = 1p..9p (圓圈)
  索子 = 1s..9s (條)
  風牌: E=東 S=南 W=西 N=北
  三元: C=中 F=發 P=白
  花:   f1=春 f2=夏 f3=秋 f4=冬
  季:   s1=梅 s2=蘭 s3=菊 s4=竹

注意:
- 廣東/港式麻雀牌 13 張(食糊有 14 張),台牌 16 張(食糊 17 張)
- "5 個圓圈" = 5p, "三條竹" = 3s, "四萬" = 4m
- 中=紅中(紅色字), 發=青發(綠色字 發), 白=白板(空白或框)
- 一定要 return valid JSON,冇任何前後文字`;

  async function recognizeTiles(imageBlob, apiKey, model) {
    if (!apiKey) throw new Error('未設定 Gemini API Key');
    model = model || 'gemini-2.0-flash';

    const base64 = await blobToBase64(imageBlob);
    const mimeType = imageBlob.type || 'image/jpeg';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API 錯誤 (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = stripCodeFence(text);
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error('Gemini 返嘅唔係有效 JSON: ' + cleaned.slice(0, 100));
    }
    return normalizeRecognized(parsed);
  }

  async function testApi(apiKey, model) {
    if (!apiKey) throw new Error('未設定 API Key');
    model = model || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ parts: [{ text: '回答只可以係:OK' }] }],
      generationConfig: { temperature: 0 }
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`(${res.status}) ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '(空白)';
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = r.result;
        const idx = s.indexOf(',');
        resolve(idx >= 0 ? s.slice(idx + 1) : s);
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function stripCodeFence(s) {
    s = s.trim();
    if (s.startsWith('```')) {
      s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    }
    return s;
  }

  function normalizeRecognized(r) {
    const tiles = (r.tiles || []).map(normalizeTile).filter(Boolean);
    const melds = (r.melds || []).map(m => ({
      type: (m.type || '').toLowerCase(),
      tiles: (m.tiles || []).map(normalizeTile).filter(Boolean),
      concealed: !!m.concealed
    })).filter(m => m.tiles.length >= 3);
    const flowers = (r.flowers || []).map(normalizeTile).filter(t => /^[fs][1-4]$/.test(t));
    const winningTile = normalizeTile(r.winning_tile || r.winningTile || '');
    const isZimo = !!(r.is_self_draw || r.isZimo || r.zimo);
    return { tiles, melds, flowers, winningTile, isZimo, confidence: r.confidence || 'medium' };
  }

  function normalizeTile(t) {
    if (!t) return null;
    if (typeof t !== 'string') return null;
    const x = t.trim();
    if (/^[1-9][mps]$/i.test(x)) return x.toLowerCase();
    if (/^[ESWNCFP]$/i.test(x)) return x.toUpperCase();
    if (/^[fs][1-4]$/i.test(x)) return x.toLowerCase();
    // 中文 fallback
    const cnMap = {
      '東': 'E', '南': 'S', '西': 'W', '北': 'N',
      '中': 'C', '紅中': 'C', '發': 'F', '白': 'P', '白板': 'P',
      '春': 'f1', '夏': 'f2', '秋': 'f3', '冬': 'f4',
      '梅': 's1', '蘭': 's2', '菊': 's3', '竹': 's4',
    };
    if (cnMap[x]) return cnMap[x];
    return null;
  }

  // ---------- Demo tile sets (冇 API 都可以試) ----------
  const DEMO_HANDS = [
    {
      name: '對對糊 + 中刻',
      state: {
        tiles: ['2m', '2m', '2m', '5p', '5p', '5p', '7s', '7s', '7s', 'C', 'C', 'C', 'E', 'E'],
        melds: [], flowers: ['f1'],
        winningTile: 'C', isZimo: true,
        seatWind: 'E', prevailingWind: 'E'
      }
    },
    {
      name: '清一色',
      state: {
        tiles: ['1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '2s', '3s', '4s', '5s', '5s'],
        melds: [], flowers: [],
        winningTile: '5s', isZimo: false,
        seatWind: 'S', prevailingWind: 'E'
      }
    },
    {
      name: '十三么',
      state: {
        tiles: ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'C', 'F', 'P', '1m'],
        melds: [], flowers: [],
        winningTile: '1m', isZimo: true,
        seatWind: 'E', prevailingWind: 'E'
      }
    },
    {
      name: '大三元',
      state: {
        tiles: ['C', 'C', 'C', 'F', 'F', 'F', 'P', 'P', 'P', '2m', '3m', '4m', '8s', '8s'],
        melds: [], flowers: [],
        winningTile: '4m', isZimo: false,
        seatWind: 'E', prevailingWind: 'E'
      }
    },
    {
      name: '平糊',
      state: {
        tiles: ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '2s', '3s', '4s', '6m', '6m'],
        melds: [], flowers: [],
        winningTile: '9s', isZimo: false,
        seatWind: 'E', prevailingWind: 'E'
      }
    },
  ];

  global.Vision = {
    recognizeTiles,
    testApi,
    DEMO_HANDS
  };

})(typeof window !== 'undefined' ? window : globalThis);

# 麻雀計番計分 (MVP)

廣東牌 / 港式台牌 嘅計分 + 影相 AI 識牌計番 web app。
PWA 設計 — 一個 codebase 喺 iPhone Safari、Android Chrome、桌面瀏覽器都用得,
仲可以「加到主畫面」變到似真 app 一樣有 icon、可以離線開。

## 功能

- **計分 tab**：4 個玩家、自動計每鋪賠款、running totals、圈風 / 莊家、撤回上一鋪
- **影相 tab**：影相或揀相 → Gemini AI 識牌 → 自動拆牌 → **顯示每樣番嘅計法**
- **設定**：規則切換 (廣東 / 港式台)、起糊番、底數、上限、自摸雙計、玩家名、API key
- **記錄**：歷史牌局歸檔
- **離線**：service worker cache 個 shell,冇網都開到(影相識別仍要網)

## 部署 (5 分鐘搞掂)

### 方案 A：GitHub Pages (推薦,免費)

1. 喺 [github.com](https://github.com/) 開個 repo,例如叫 `mahjong-kit`
2. 將 `mahjong-app/` 入面所有檔案 upload 上去 (drag & drop 都得)
3. Repo 入面去 **Settings → Pages**,Source 揀 `main` branch、`/ (root)`、撳 Save
4. 等 1 分鐘,你會見到 URL 例如 `https://你個username.github.io/mahjong-kit/`
5. 用 iPhone / Android 開呢個 URL → Safari 撳 [分享] → 「加到主畫面」

### 方案 B：Netlify Drop (最簡單,30 秒)

1. 去 [app.netlify.com/drop](https://app.netlify.com/drop)
2. 將成個 `mahjong-app` folder drag 落去
3. 你即刻會有條 URL,用佢就得

### 方案 C：本機快試(只係用瀏覽器睇下 UI,部份功能會壞)

雙擊 `index.html` 用瀏覽器開到 — 但 service worker 同 camera 部份要 https,
所以正式用嘅話一定要 host 上去。

## 攞 Gemini API Key (免費)

1. 上 [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. 用 Google account 登入
3. 撳 **Create API key** → copy 個 key (`AIza...` 開頭)
4. 開 app,去 **設定** tab,paste 落「Gemini API Key」入面
5. 撳「測試 API」確認通到

免費 quota:Gemini 2.0 Flash 每分鐘 15 次、每日 1500 次,夠玩到飽。

## 用法

### 計分流程

1. 第一次入,撳「新一局」
2. 改玩家名、揀莊家、揀圈風 → 開始
3. 每食一鋪撳「＋ 加一鋪」
   - 揀「食糊」、自摸、流局
   - 揀邊個糊、邊個放炮(食糊先要)
   - 入番數同花
   - 撳「確認」就自動計賠款
4. 想撤回最後一鋪 → 撳「↶ 撤回」

### 影相計番流程

1. 去「影相」tab
2. 撳「📷 影相 / 揀相」(iPhone 會問你開相機定揀相簿)
3. 等幾秒 AI 識別
4. 睇下「識別到嘅牌」啱唔啱;唔啱可以撳「手動修正」改
5. 下面個「計法」會列晒每樣番(例如 對對糊 +3、中刻 +1、自摸 +1...)
6. 撳「寫入今鋪」就直接套用到計分,唔使再手動入番數

### 規則切換

去「設定」tab → 規則 → 揀「廣東牌」或者「港式台牌」。
番數表會自動切換,單位 (番 / 台) 同起糊預設值都會跟住變。

## 結構

```
mahjong-app/
├── index.html              主 UI
├── styles.css              樣式
├── app.js                  主 controller (UI / 狀態 / 流程)
├── scoring.js              計番引擎 (廣東 + 港式台 番數表 + 牌型偵測)
├── vision.js               Gemini API 整合 + 示範牌
├── manifest.webmanifest    PWA manifest
├── sw.js                   Service worker (離線 cache)
├── icon.svg                App icon
└── README.md               本檔
```

## 已支援嘅牌型 (節錄)

**廣東牌 (番)**：平糊、對對糊、混一色、清一色、字一色、混老頭、清老頭、
大三元、小三元、大四喜、小四喜、十三么、九子連環、一條龍、三色同順、
三色同刻、圈風刻、門風刻、三元刻、自摸、門前清、海底/河底、槓上開花、搶槓、花/季。

**港式台牌 (台)**：平胡、碰碰胡、混一色、清一色、字一色、混老頭、清老頭、
大/小三元、大/小四喜、一條龍、三色同順、三色同刻、三/四/五暗刻、圈風刻、
門風刻、自摸、門清、不求人、海底/河底、槓上開花、搶槓、花/季。

## 已知限制 (MVP)

- 自摸:預設「三家齊出」(各家平攤),冇分莊家加倍 — 如要可以開「自摸雙計」
- 流局唔自動 split 賠款
- 副露(碰/槓/吃)識別:AI 通常識,但如果擺位太散,可能漏 — 用「手動修正」cover
- 唔包邊張聽牌、地獄單騎、四杠等罕見牌型
- 圈風 / 莊家轉莊要手撳「⋯」menu 改

## 之後可加 (v0.2 諗緊)

- 連莊計算 / 自動轉莊
- 將牌局 export 做圖 share 到 WhatsApp
- 多人線上對戰 (Firebase / Supabase)
- 自定番數表
- 真正 native 包裝 (Capacitor → App Store / Play Store)

## License

MVP prototype,自由用。

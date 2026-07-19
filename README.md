# TimePortal 修正版

這一版修正兩個問題：

1. **人物遮罩方向反了**
   - 使用 `segmentationMask → source-in → 原始影像`
   - 結果是「保留人物、背景透明」，不再是把人物挖掉。

2. **連線失敗與相機錯誤看不到真正原因**
   - 所有主要錯誤都會 `console.error(...)`
   - 手機畫面會顯示 `error.name`、`error.message`、安全環境、瀏覽器能力、LINE WebView 與 userAgent。
   - 偵測到 LINE 內建瀏覽器時，會提示改用系統 Chrome 或 Safari。

## 上傳方式

把以下檔案放在 GitHub Pages 專案根目錄：

- `index.html`
- `style.css`
- `script.js`
- `background.jpg`（請沿用你自己的老照片）

## 測試網址

首頁：
`https://array0160.github.io/TimePortal/`

大螢幕：
首頁按「我是工作人員」，系統會自動進入 `?mode=screen`。

手機：
掃大螢幕產生的 QR Code，會自動進入 `?mode=mobile&room=...`。

## 重要限制

目前程式仍使用 PeerJS Cloud 來驗證流程。正式展覽要改成自己的 PeerJS signaling server，
需要提供 server 的 `host`、`port`、`path`、是否使用 TLS，才能填入正式設定。


## v2 修正
上一版 `script.js` 第一個字元誤多出 `\`，瀏覽器因此產生 JavaScript SyntaxError，
導致首頁內容沒有渲染，只看到黑色背景。v2 已移除該字元。

本機直接以 `file:///` 開啟只能檢查首頁版面；相機與完整連線請部署到 GitHub Pages 的 HTTPS 網址測試。


## v4 修正：手機「開啟相機」按鈕點了沒反應

原因是全螢幕透明的 `personCanvas` 位於按鈕上方。雖然看不到 canvas，
它仍會攔截手機觸控，因此按鈕沒有 pressed 感，也不會觸發 click。

v4 已修正：

- `personCanvas` 加上 `pointer-events: none`
- `startLayer` 設定明確的 `z-index`
- 按鈕加入手機觸控回饋
- 點擊後立即在面板顯示啟動進度
- 未捕捉的 JavaScript / Promise 錯誤也會顯示在畫面
- QR Code CDN 改成與 `new QRCode(...)` 程式相符的 qrcodejs

請完整覆蓋 `index.html`、`style.css`、`script.js`，並在手機瀏覽器重新整理。
若 GitHub Pages 快取舊檔，可在網址最後暫時加上 `&v=4` 後再開啟。


## v5 修正：去背人物後出現黑色長方形

這不是 MediaPipe 去背方向錯誤，而是一般 WebRTC 視訊編碼不會傳送 canvas 的 alpha 透明通道。
透明區域經 WebRTC 編碼後會變成黑色，所以大螢幕看到人物外面有整塊黑框。

v5 改用單一路「RGB + Mask」傳輸：

- 手機傳送左右並排影像
  - 左半：原始相機 RGB
  - 右半：MediaPipe 灰階人物遮罩
- 大螢幕收到後，把右半遮罩重新寫入左半的 alpha
- 最後將透明人物 canvas 疊在 `background.jpg` 上

因此人物外面會真正透明，不再依賴 WebRTC 傳送 alpha，也不會再有黑色長方形。

請完整覆蓋：

- `index.html`
- `style.css`
- `script.js`

上傳後建議在大螢幕網址加 `&v=5` 或強制重新整理，避免 GitHub Pages／瀏覽器沿用 v4 快取。


## v6 修正：人物半透明、手機轉向沒有跟著旋轉

### 人物半透明
v5 將收到的遮罩用 10～245 做線性 alpha，WebRTC 壓縮後人物區的遮罩值下降，
因此整個人物被誤判為半透明。

v6 改成：

- 遮罩值 28 以下：完全透明
- 遮罩值 78 以上：完全不透明
- 只有 28～78 的人物邊緣保留短距離柔化

人物臉部、衣服與身體會是完整不透明，老照片只會出現在人物外部。

### 手機轉向
v6 每一幀會比較：

- 手機目前是直向或橫向
- 相機 frame 實際寬高

若 Android 瀏覽器沒有自動旋轉 camera frame，程式會先同步旋轉原始畫面與
MediaPipe 遮罩，再送到大螢幕。直向轉橫向、橫向轉直向時，不需要重新掃 QR Code。

請完整覆蓋 `index.html`、`style.css`、`script.js`，並讓大螢幕與手機都重新載入。
建議測試網址暫時加上 `v=6`，避開瀏覽器快取。


## v7：針對「看起來完全沒更新」重新修正

上一版雖然在網址加了 `v=6`，但 `index.html` 載入的仍是同一個
`script.js` 與 `style.css` 網址，手機與大螢幕很可能繼續使用瀏覽器快取的舊檔。
而且大螢幕產生手機 QR Code 時，也沒有保留版本參數。

v7 已做三個關鍵修正：

1. `script.js?v=7.0.0`、`style.css?v=7.0.0`
2. QR Code 手機網址會帶 `build=v7.0.0`
3. 畫面直接顯示 `程式版本：v7.0.0`，可確認新檔是否真的載入

### 人物不透明

手機端先把 MediaPipe 遮罩轉成只有黑色與白色的二值遮罩。
大螢幕收到後，人物 alpha 只會是：

- 0：透明背景
- 255：完全不透明人物

不再存在半透明人物。

### 手機轉向

傳輸 Canvas 固定為 1280 × 640，不再於轉向時改變串流解析度。
左右兩半各 640 × 640，人物會依手機目前直向／橫向旋轉後放進固定畫布。
這可避開部分 Android 瀏覽器不重新協商 Canvas captureStream 尺寸的問題。


## v8 修正：人物外圍白邊

白邊不是 CSS 邊框，也不是背景圖露出。它由三件事疊加造成：

1. MediaPipe 的人物遮罩在頭髮、肩膀等邊緣會含入少量原始背景。
2. v7 使用較低遮罩門檻，保留了太多人物外圈。
3. 黑白遮罩經 WebRTC 有損壓縮後會產生灰階 ringing，低門檻又把這些灰階當成人物。

v8 改為：

- 提高手機端遮罩門檻。
- 將遮罩向人物內縮約 3px。
- 傳送前先用侵蝕後遮罩裁掉 RGB 的原始背景。
- 大螢幕端提高遮罩解碼門檻。
- 只在極窄邊緣保留柔化，人物本體仍完全不透明。

請完整覆蓋 `index.html`、`style.css`、`script.js`。
畫面版本必須顯示 `v8.0.0`，否則仍是瀏覽器舊快取。


## v9 修正：開啟相機後整片黑

真正原因是 MediaPipe 的 `segmentationMask` 在不同 Android 瀏覽器或 GPU 上，
遮罩值可能放在 RGB 灰階，也可能放在 Alpha 通道。

v8 只讀 RGB。使用者的手機若把遮罩放在 Alpha，程式讀到的 RGB 幾乎都是 0，
便會把整個人物判定為背景，最終畫面全透明；頁面背景是黑色，所以看起來整片黑。

v9 改為：

- 自動檢測遮罩資料位於 RGB 還是 Alpha。
- 遮罩尚未就緒或面積異常時，先顯示原始相機預覽，不再黑畫面。
- 有效遮罩才進行人物裁切與傳送。
- 侵蝕由 3px 降為 1px，避免把頭髮、肩膀和小範圍人物全部吃掉。
- 手機狀態會顯示 `RGB`、`alpha` 與人物覆蓋率，方便確認實際遮罩來源。

請完整覆蓋 `index.html`、`style.css`、`script.js`。
大螢幕與手機都必須看到版本 `v9.0.0`。


## v11：MediaPipe 官方全解析度合成測試

此版本新增：

`?mode=officialtest`

核心做法直接對照 MediaPipe 官方範例：

1. 相機優先要求 1080p，失敗才退回 720p。
2. `results.segmentationMask` 只負責決定人物範圍。
3. 人物像素直接使用 `results.image` 原始解析度。
4. Canvas 尺寸等於相機／`results.image` 的實際尺寸。
5. 不將人物 RGB 縮成 640×640。
6. 不傳送 RGB＋Mask 並排影片。
7. 手機轉向時重新取得符合新方向的相機串流。

### 測試網址

`https://你的 GitHub Pages 網址/?mode=officialtest`

或從首頁按「官方高清合成測試」。

### 判斷是否成功

畫面狀態應顯示：

- 相機實際解析度
- `results.image／Canvas` 解析度
- Track 實際解析度
- FPS

例如：

`相機實際：1920×1080`
`results.image／Canvas：1920×1080`

這個模式暫時只測手機本機效果，不連接大螢幕。
先確認人物本體是否清楚、直橫方向是否正確，再將同一套合成方式移到大螢幕端。

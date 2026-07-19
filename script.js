(() => {
  "use strict";

  const app = document.getElementById("app");
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") || "home";
  const room = params.get("room") || "";
  const BUILD_ID = "v11.0.0";

  const $ = (selector, root = document) => root.querySelector(selector);

  function go(nextMode, extra = {}) {
    const q = new URLSearchParams({ mode: nextMode, ...extra });
    location.href = `${location.pathname}?${q.toString()}`;
  }

  function browserInfo() {
    const ua = navigator.userAgent || "";
    return {
      ua,
      isLine: /Line\/|LIFF/i.test(ua),
      isIOS: /iPhone|iPad|iPod/i.test(ua),
      isAndroid: /Android/i.test(ua),
      secure: window.isSecureContext,
      mediaDevices: !!navigator.mediaDevices,
      getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    };
  }

  function errorText(error, title = "發生錯誤") {
    const info = browserInfo();
    const name = error?.name || "UnknownError";
    const message = error?.message || String(error || "未知錯誤");
    return [
      title,
      `error.name: ${name}`,
      `error.message: ${message}`,
      `secureContext: ${info.secure}`,
      `mediaDevices: ${info.mediaDevices}`,
      `getUserMedia: ${info.getUserMedia}`,
      `LINE WebView: ${info.isLine}`,
      `URL: ${location.href}`,
      `userAgent: ${info.ua}`,
    ].join("\n");
  }

  function showError(error, target = "#errorBox", title) {
    console.error(title || "TimePortal error", error);
    const box = $(target);
    if (box) {
      box.textContent = errorText(error, title);
      box.classList.remove("hidden");
    }
  }

  function renderHome() {
    app.innerHTML = `
      <section class="page">
        <div class="panel">
          <h1>TimePortal</h1>
          <p>老照片互動穿越</p>
          <div class="actions">
            <button class="primary" id="screenBtn">我是工作人員</button>
            <button id="mobileBtn">我是觀眾</button>
            <button id="officialTestBtn">官方高清合成測試</button>
          </div>
          <p class="note">工作人員請在大螢幕開啟；觀眾通常直接掃描大螢幕上的 QR Code。</p>
        </div>
      </section>`;
    $("#screenBtn").onclick = () => go("screen");
    $("#mobileBtn").onclick = () => go("mobile");
    $("#officialTestBtn").onclick = () => go("officialtest");
  }

  async function createPeer(options = undefined) {
    if (!window.Peer) throw new Error("PeerJS 尚未載入，請檢查網路或 CDN。");
    return new Promise((resolve, reject) => {
      const peer = new Peer(options);
      const timer = setTimeout(() => reject(new Error("PeerJS 連線逾時。")), 12000);
      peer.once("open", () => {
        clearTimeout(timer);
        resolve(peer);
      });
      peer.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async function renderScreen() {
    app.innerHTML = `
      <section class="screen-stage">
        <video id="remoteVideo" autoplay playsinline muted></video>
        <canvas id="compositeCanvas"></canvas>

        <div class="screen-overlay">
          <h2>掃描 QR Code</h2>
          <div id="qrCode" aria-label="手機連線 QR Code"></div>
          <p class="room" id="roomText">正在建立房間…</p>
          <div class="status-pill" id="screenStatus">連線：初始化</div>
          <p class="build-label">程式版本：${BUILD_ID}</p>
          <div class="error-box hidden" id="errorBox"></div>
        </div>
      </section>`;

    const status = $("#screenStatus");
    const remoteVideo = $("#remoteVideo");
    const compositeCanvas = $("#compositeCanvas");
    const compositeCtx = compositeCanvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });

    const rgbCanvas = document.createElement("canvas");
    const rgbCtx = rgbCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const maskCanvas = document.createElement("canvas");
    const maskCtx = maskCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    let renderingRemote = false;
    let lastRemoteTime = -1;
    let lastCompositeAt = 0;

    function clearComposite() {
      compositeCtx.clearRect(
        0,
        0,
        compositeCanvas.width,
        compositeCanvas.height
      );
    }

    function compositeRemoteFrame(timestamp = 0) {
      if (!renderingRemote) return;

      const shouldProcess =
        remoteVideo.readyState >= 2 &&
        remoteVideo.videoWidth >= 4 &&
        remoteVideo.currentTime !== lastRemoteTime &&
        timestamp - lastCompositeAt >= 60;

      if (shouldProcess) {
        lastRemoteTime = remoteVideo.currentTime;
        lastCompositeAt = timestamp;

        const sourceWidth = remoteVideo.videoWidth;
        const sourceHeight = remoteVideo.videoHeight;
        const halfWidth = sourceWidth / 2;
        const personWidth = Math.max(1, Math.floor(halfWidth));
        const personHeight = Math.max(1, sourceHeight);

        if (
          compositeCanvas.width !== personWidth ||
          compositeCanvas.height !== personHeight
        ) {
          compositeCanvas.width = personWidth;
          compositeCanvas.height = personHeight;
          rgbCanvas.width = personWidth;
          rgbCanvas.height = personHeight;
          maskCanvas.width = personWidth;
          maskCanvas.height = personHeight;
        }

        try {
          rgbCtx.drawImage(
            remoteVideo,
            0,
            0,
            halfWidth,
            sourceHeight,
            0,
            0,
            personWidth,
            personHeight
          );

          maskCtx.drawImage(
            remoteVideo,
            halfWidth,
            0,
            halfWidth,
            sourceHeight,
            0,
            0,
            personWidth,
            personHeight
          );

          const rgbImage = rgbCtx.getImageData(
            0,
            0,
            personWidth,
            personHeight
          );
          const maskImage = maskCtx.getImageData(
            0,
            0,
            personWidth,
            personHeight
          );

          const rgb = rgbImage.data;
          const mask = maskImage.data;

          /*
            v9：
            手機傳來的是黑白遮罩，但 WebRTC 可能把 0／255 壓成灰階。
            這裡只輸出 0 或 255，人物一定不透明。
          */
          for (let i = 0; i < rgb.length; i += 4) {
            const maskValue =
              (mask[i] + mask[i + 1] + mask[i + 2]) / 3;
            rgb[i + 3] = maskValue >= 128 ? 255 : 0;
          }

          compositeCtx.putImageData(rgbImage, 0, 0);
        } catch (error) {
          renderingRemote = false;
          status.textContent = "合成：failed";
          showError(
            error,
            "#errorBox",
            "大螢幕人物合成失敗"
          );
          return;
        }
      }

      requestAnimationFrame(compositeRemoteFrame);
    }

    try {
      status.textContent = "連線：建立房間";
      const peer = await createPeer();
      const roomId = peer.id;

      const mobileUrl = new URL(location.href);
      mobileUrl.search = new URLSearchParams({
        mode: "mobile",
        room: roomId,
        build: BUILD_ID,
      }).toString();

      $("#roomText").textContent = `Room: ${roomId}`;

      if (!window.QRCode) {
        throw new Error(
          "QR Code 函式庫尚未載入，請重新整理頁面或檢查網路。"
        );
      }

      const qrTarget = $("#qrCode");
      qrTarget.innerHTML = "";
      new QRCode(qrTarget, {
        text: mobileUrl.toString(),
        width: 260,
        height: 260,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });

      status.textContent = "連線：等待手機";

      peer.on("call", (call) => {
        status.textContent = "連線：接收手機影像";
        call.answer();

        call.on("stream", async (stream) => {
          remoteVideo.srcObject = stream;

          try {
            await remoteVideo.play();
            renderingRemote = true;
            lastRemoteTime = -1;
            lastCompositeAt = 0;
            requestAnimationFrame(compositeRemoteFrame);
            status.textContent = "連線：成功（人物不透明）";
          } catch (error) {
            showError(
              error,
              "#errorBox",
              "大螢幕無法播放串流"
            );
          }
        });

        call.on("close", () => {
          renderingRemote = false;
          status.textContent = "連線：手機已離線";
          remoteVideo.srcObject = null;
          clearComposite();
        });

        call.on("error", (error) => {
          status.textContent = "連線：failed";
          showError(
            error,
            "#errorBox",
            "WebRTC 通話錯誤"
          );
        });
      });

      peer.on("disconnected", () => {
        status.textContent = "連線：重新連接";
        try {
          peer.reconnect();
        } catch (error) {
          showError(
            error,
            "#errorBox",
            "PeerJS 重新連線失敗"
          );
        }
      });

      peer.on("error", (error) => {
        status.textContent = "連線：failed";
        showError(error, "#errorBox", "PeerJS 錯誤");
      });
    } catch (error) {
      status.textContent = "連線：failed";
      showError(
        error,
        "#errorBox",
        "大螢幕房間建立失敗"
      );
    }
  }

  async function getCameraStream(facingMode) {
    if (!window.isSecureContext) {
      const err = new Error("目前不是安全環境。相機必須使用 HTTPS 或 localhost。");
      err.name = "SecurityError";
      throw err;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error("此瀏覽器不支援 navigator.mediaDevices.getUserMedia。請改用系統 Chrome 或 Safari。");
      err.name = "NotSupportedError";
      throw err;
    }

    const preferred = {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    try {
      return await navigator.mediaDevices.getUserMedia(preferred);
    } catch (firstError) {
      // 某些 Android WebView 不接受 facingMode constraint，退回最基本設定再試一次。
      console.warn("Preferred camera constraints failed; retrying basic video.", firstError);
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
  }


  function renderOfficialTest() {
    const info = browserInfo();

    app.innerHTML = `
      <section class="official-stage">
        <video id="officialVideo" autoplay playsinline muted></video>
        <canvas id="officialCanvas"></canvas>

        <div class="official-topbar">
          <div class="official-badge">
            MediaPipe 官方高清合成｜${BUILD_ID}
          </div>
        </div>

        <div class="official-controls">
          <button id="officialSwitchBtn" disabled>
            切換前／後鏡頭
          </button>
          <button id="officialRestartBtn" disabled>
            重新取得方向
          </button>
          <div class="official-status" id="officialStatus">
            尚未開啟相機
          </div>
        </div>

        <section class="official-start-layer" id="officialStartLayer">
          <div class="panel">
            <h2>官方全解析度合成測試</h2>
            <div class="official-explanation">
              <p>
                這版按照 MediaPipe 官方範例的核心做法：
                遮罩只決定人物範圍，人物像素直接取自原始相機畫面。
              </p>
              <p>
                不會把人物 RGB 縮成 640×640，也不會傳送
                RGB＋Mask 並排影片。這個模式先只測手機本機畫質與轉向。
              </p>
              <div class="actions">
                <button class="primary" id="officialStartBtn" type="button">
                  開啟相機測試
                </button>
              </div>

              ${info.isLine ? `
                <div class="warning">
                  偵測到 LINE 內建瀏覽器。請改用系統 Chrome、
                  Samsung Internet 或 Safari。
                </div>` : ""}

              <div class="error-box hidden" id="errorBox"></div>

              <div class="debug-box">${[
                `build: ${BUILD_ID}`,
                `secureContext: ${info.secure}`,
                `getUserMedia: ${info.getUserMedia}`,
                `合成方式: results.image 原始解析度 + segmentationMask`,
              ].join("\n")}</div>
            </div>
          </div>
        </section>
      </section>`;

    const video = $("#officialVideo");
    const outputCanvas = $("#officialCanvas");
    const outputCtx = outputCanvas.getContext("2d", {
      alpha: false,
    });

    const personCanvas = document.createElement("canvas");
    const personCtx = personCanvas.getContext("2d", {
      alpha: true,
    });

    const backgroundImage = new Image();
    backgroundImage.src = "./background.jpg";

    const startLayer = $("#officialStartLayer");
    const startBtn = $("#officialStartBtn");
    const switchBtn = $("#officialSwitchBtn");
    const restartBtn = $("#officialRestartBtn");
    const status = $("#officialStatus");

    let stream = null;
    let segmentation = null;
    let facingMode = "user";
    let running = false;
    let frameBusy = false;
    let starting = false;
    let orientationTimer = null;
    let lastRenderedAt = performance.now();
    let smoothedFps = 0;

    function setStatus(message) {
      status.textContent = message;
    }

    function drawBackgroundCover(ctx, width, height) {
      if (!backgroundImage.complete || !backgroundImage.naturalWidth) {
        ctx.fillStyle = "#222";
        ctx.fillRect(0, 0, width, height);
        return;
      }

      const scale = Math.max(
        width / backgroundImage.naturalWidth,
        height / backgroundImage.naturalHeight
      );

      const drawWidth = backgroundImage.naturalWidth * scale;
      const drawHeight = backgroundImage.naturalHeight * scale;
      const x = (width - drawWidth) / 2;
      const y = (height - drawHeight) / 2;

      ctx.drawImage(
        backgroundImage,
        x,
        y,
        drawWidth,
        drawHeight
      );
    }

    function ensureCanvasSize(width, height) {
      if (!width || !height) return false;

      if (
        outputCanvas.width !== width ||
        outputCanvas.height !== height
      ) {
        outputCanvas.width = width;
        outputCanvas.height = height;
        personCanvas.width = width;
        personCanvas.height = height;
      }

      return true;
    }

    function getResultSize(image) {
      return {
        width:
          image.videoWidth ||
          image.naturalWidth ||
          image.width ||
          video.videoWidth ||
          0,
        height:
          image.videoHeight ||
          image.naturalHeight ||
          image.height ||
          video.videoHeight ||
          0,
      };
    }

    async function initSegmentation() {
      if (segmentation) return;

      if (!window.SelfieSegmentation) {
        throw new Error(
          "MediaPipe Selfie Segmentation 尚未載入。"
        );
      }

      segmentation = new SelfieSegmentation({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
      });

      /*
        官方 general model。
        重要的是 results.image 仍是原始相機解析度，
        模型內部遮罩解析度不會降低人物 RGB 紋理。
      */
      segmentation.setOptions({
        modelSelection: 0,
        selfieMode: false,
      });

      segmentation.onResults((results) => {
        frameBusy = false;
        if (!running) return;

        const size = getResultSize(results.image);
        if (!ensureCanvasSize(size.width, size.height)) {
          return;
        }

        /*
          官方方法的核心：
          1. segmentationMask 決定人物區域
          2. source-in 保留 results.image 的原始高清人物像素
          3. destination-over 在人物後方畫 background.jpg

          這裡沒有把 results.image 縮成 640 方形。
        */
        personCtx.save();
        personCtx.setTransform(1, 0, 0, 1, 0, 0);
        personCtx.clearRect(0, 0, size.width, size.height);

        if (facingMode === "user") {
          personCtx.translate(size.width, 0);
          personCtx.scale(-1, 1);
        }

        personCtx.drawImage(
          results.segmentationMask,
          0,
          0,
          size.width,
          size.height
        );

        personCtx.globalCompositeOperation = "source-in";

        personCtx.drawImage(
          results.image,
          0,
          0,
          size.width,
          size.height
        );

        personCtx.restore();

        outputCtx.save();
        outputCtx.setTransform(1, 0, 0, 1, 0, 0);
        outputCtx.clearRect(0, 0, size.width, size.height);

        drawBackgroundCover(
          outputCtx,
          size.width,
          size.height
        );

        outputCtx.drawImage(
          personCanvas,
          0,
          0,
          size.width,
          size.height
        );

        outputCtx.restore();

        const now = performance.now();
        const instantFps =
          1000 / Math.max(1, now - lastRenderedAt);
        smoothedFps =
          smoothedFps === 0
            ? instantFps
            : smoothedFps * 0.85 + instantFps * 0.15;
        lastRenderedAt = now;

        const orientation =
          innerWidth > innerHeight ? "橫向" : "直向";

        const track = stream?.getVideoTracks?.()[0];
        const settings = track?.getSettings?.() || {};

        setStatus([
          `官方全解析度合成：運作中`,
          `方向：${orientation}`,
          `相機實際：${video.videoWidth}×${video.videoHeight}`,
          `results.image／Canvas：${size.width}×${size.height}`,
          `Track：${settings.width || "?"}×${settings.height || "?"}`,
          `約 ${smoothedFps.toFixed(1)} FPS`,
        ].join("\n"));
      });

      await segmentation.initialize();
    }

    async function acquireCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        const error = new Error(
          "此瀏覽器不支援 getUserMedia。"
        );
        error.name = "NotSupportedError";
        throw error;
      }

      const portrait = innerHeight >= innerWidth;

      const preferred = {
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: {
            ideal: portrait ? 1080 : 1920,
            min: portrait ? 720 : 1280,
          },
          height: {
            ideal: portrait ? 1920 : 1080,
            min: portrait ? 1280 : 720,
          },
          frameRate: {
            ideal: 30,
            min: 20,
            max: 30,
          },
        },
      };

      try {
        return await navigator.mediaDevices.getUserMedia(
          preferred
        );
      } catch (preferredError) {
        console.warn(
          "1080p 相機要求失敗，退回 720p。",
          preferredError
        );

        return navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            width: {
              ideal: portrait ? 720 : 1280,
            },
            height: {
              ideal: portrait ? 1280 : 720,
            },
            frameRate: {
              ideal: 30,
              max: 30,
            },
          },
        });
      }
    }

    async function startCamera({
      hideStartLayer = true,
    } = {}) {
      if (starting) return;
      starting = true;

      running = false;
      frameBusy = false;
      setStatus("正在取得高清相機…");

      try {
        stream
          ?.getTracks()
          .forEach((track) => track.stop());

        stream = await acquireCamera();
        video.srcObject = stream;

        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(
              new Error("等待相機 metadata 逾時。")
            ),
            10000
          );

          const finish = () => {
            clearTimeout(timer);
            resolve();
          };

          if (video.readyState >= 1) {
            finish();
          } else {
            video.addEventListener(
              "loadedmetadata",
              finish,
              { once: true }
            );
          }
        });

        await video.play();
        await initSegmentation();

        running = true;
        switchBtn.disabled = false;
        restartBtn.disabled = false;

        if (hideStartLayer) {
          startLayer.classList.add("hidden");
        }

        setStatus(
          `相機已啟動：${video.videoWidth}×${video.videoHeight}`
        );

        requestAnimationFrame(frameLoop);
      } finally {
        starting = false;
      }
    }

    async function frameLoop() {
      if (!running) return;

      if (!frameBusy && video.readyState >= 2) {
        frameBusy = true;

        try {
          await segmentation.send({ image: video });
        } catch (error) {
          frameBusy = false;
          running = false;
          showError(
            error,
            "#errorBox",
            "MediaPipe 官方高清合成失敗"
          );
          setStatus("MediaPipe：failed");
          return;
        }
      }

      requestAnimationFrame(frameLoop);
    }

    function scheduleOrientationRestart() {
      if (!running) return;

      clearTimeout(orientationTimer);
      setStatus("偵測到手機轉向，正在重新取得相機方向…");

      orientationTimer = setTimeout(async () => {
        try {
          await startCamera({
            hideStartLayer: false,
          });
        } catch (error) {
          showError(
            error,
            "#errorBox",
            "轉向後重新取得相機失敗"
          );
          setStatus("轉向重新取得：failed");
        }
      }, 500);
    }

    startBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      startBtn.disabled = true;
      startBtn.textContent = "啟動中…";

      try {
        await startCamera();
      } catch (error) {
        showError(
          error,
          "#errorBox",
          "官方高清測試相機啟動失敗"
        );
        setStatus("相機：failed");
        startBtn.disabled = false;
        startBtn.textContent = "重新開啟相機";
      }
    });

    switchBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      switchBtn.disabled = true;

      facingMode =
        facingMode === "user"
          ? "environment"
          : "user";

      try {
        await startCamera({
          hideStartLayer: false,
        });
      } catch (error) {
        showError(
          error,
          "#errorBox",
          "切換鏡頭失敗"
        );
      } finally {
        switchBtn.disabled = false;
      }
    });

    restartBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      restartBtn.disabled = true;

      try {
        await startCamera({
          hideStartLayer: false,
        });
      } catch (error) {
        showError(
          error,
          "#errorBox",
          "重新取得相機方向失敗"
        );
      } finally {
        restartBtn.disabled = false;
      }
    });

    window.addEventListener(
      "orientationchange",
      scheduleOrientationRestart
    );

    screen.orientation?.addEventListener?.(
      "change",
      scheduleOrientationRestart
    );

    window.addEventListener("beforeunload", () => {
      running = false;
      stream
        ?.getTracks()
        .forEach((track) => track.stop());
      segmentation?.close?.();
    });
  }

  function renderMobile() {
    const info = browserInfo();

    app.innerHTML = `
      <section class="mobile-stage">
        <video id="cameraVideo" autoplay playsinline muted></video>
        <canvas id="personCanvas"></canvas>

        <div class="floating">
          <button id="switchBtn" disabled>切換前／後鏡頭</button>
          <div class="status-pill" id="mobileStatus">尚未開啟相機</div>
        </div>

        <section class="page" id="startLayer">
          <div class="panel">
            <h2>手機相機</h2>
            <p>開啟後只保留不透明人物，背景透明並傳送到大螢幕。</p>

            <div class="actions">
              <button class="primary" id="startBtn" type="button">
                開啟相機
              </button>
            </div>

            <p class="start-status" id="startStatus">
              等待按下「開啟相機」
            </p>

            ${info.isLine ? `
              <div class="warning">
                偵測到 LINE 內建瀏覽器。請改用系統 Chrome 或 Safari。
              </div>` : ""}

            <div class="error-box hidden" id="errorBox"></div>

            <div class="debug-box">${[
              `build: ${BUILD_ID}`,
              `secureContext: ${info.secure}`,
              `mediaDevices: ${info.mediaDevices}`,
              `getUserMedia: ${info.getUserMedia}`,
              `LINE WebView: ${info.isLine}`,
              `room: ${room || "(未指定)"}`,
            ].join("\n")}</div>
          </div>
        </section>
      </section>`;

    const video = $("#cameraVideo");
    const previewCanvas = $("#personCanvas");
    const previewCtx = previewCanvas.getContext("2d", {
      alpha: true,
    });

    /*
      固定傳輸尺寸非常重要。
      Canvas captureStream 在部分 Android 瀏覽器中，
      不會可靠地跟著 Canvas 尺寸變更重新協商。

      每一半固定 640 × 640：
      左半 = 已校正方向的原始 RGB
      右半 = 已二值化的黑白人物遮罩
    */
    const FRAME_SIZE = 640;
    const sendCanvas = document.createElement("canvas");
    sendCanvas.width = FRAME_SIZE * 2;
    sendCanvas.height = FRAME_SIZE;

    const sendCtx = sendCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });

    const orientedImageCanvas = document.createElement("canvas");
    orientedImageCanvas.width = FRAME_SIZE;
    orientedImageCanvas.height = FRAME_SIZE;
    const orientedImageCtx = orientedImageCanvas.getContext("2d");

    const binaryMaskCanvas = document.createElement("canvas");
    binaryMaskCanvas.width = FRAME_SIZE;
    binaryMaskCanvas.height = FRAME_SIZE;
    const binaryMaskCtx = binaryMaskCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    /*
      MediaPipe 的人物邊界本來就可能含有一圈原始背景。
      erodedMaskCanvas 將遮罩向人物內縮 3px，去掉亮色背景光暈。
    */
    const erodedMaskCanvas = document.createElement("canvas");
    erodedMaskCanvas.width = FRAME_SIZE;
    erodedMaskCanvas.height = FRAME_SIZE;
    const erodedMaskCtx = erodedMaskCanvas.getContext("2d");

    /*
      傳送前先用侵蝕後遮罩裁掉 RGB 背景。
      這可避免 WebRTC 遮罩壓縮後，重新露出白色牆面／天花板。
    */
    const transportRgbCanvas = document.createElement("canvas");
    transportRgbCanvas.width = FRAME_SIZE;
    transportRgbCanvas.height = FRAME_SIZE;
    const transportRgbCtx = transportRgbCanvas.getContext("2d", {
      alpha: true,
    });

    const startBtn = $("#startBtn");
    const switchBtn = $("#switchBtn");
    const startLayer = $("#startLayer");
    const status = $("#mobileStatus");
    const startStatus = $("#startStatus");

    let cameraStream = null;
    let outputStream = null;
    let peer = null;
    let call = null;
    let segmentation = null;
    let facingMode = "user";
    let running = false;
    let frameBusy = false;
    let starting = false;
    let lastOrientationLabel = "";
    let lastMaskChannel = "尚未取得";
    let lastMaskCoverage = 0;

    function setMobileStatus(message) {
      status.textContent = message;
      if (startStatus) startStatus.textContent = message;
    }

    function getOrientationAngle() {
      const raw =
        screen.orientation?.angle ??
        window.orientation ??
        0;

      const normalized =
        ((Number(raw) % 360) + 360) % 360;

      return [0, 90, 180, 270].includes(normalized)
        ? normalized
        : 0;
    }

    function getSourceSize(source) {
      return {
        width:
          source.videoWidth ||
          source.naturalWidth ||
          source.width ||
          video.videoWidth ||
          720,
        height:
          source.videoHeight ||
          source.naturalHeight ||
          source.height ||
          video.videoHeight ||
          1280,
      };
    }

    function getRequiredRotation(sourceWidth, sourceHeight) {
      const viewportLandscape =
        window.innerWidth > window.innerHeight;
      const sourceLandscape =
        sourceWidth > sourceHeight;

      /*
        若相機 frame 已跟著手機轉向，rotation = 0。
        若 frame 沒有跟著轉，依 screen.orientation.angle 補轉 90 度。
      */
      if (viewportLandscape === sourceLandscape) {
        return 0;
      }

      return getOrientationAngle() === 270 ? -90 : 90;
    }

    function drawOrientedContain(
      targetCtx,
      source,
      sourceWidth,
      sourceHeight,
      rotation
    ) {
      const rotatedWidth =
        Math.abs(rotation) === 90
          ? sourceHeight
          : sourceWidth;
      const rotatedHeight =
        Math.abs(rotation) === 90
          ? sourceWidth
          : sourceHeight;

      const scale = Math.min(
        FRAME_SIZE / rotatedWidth,
        FRAME_SIZE / rotatedHeight
      );

      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
      targetCtx.translate(FRAME_SIZE / 2, FRAME_SIZE / 2);
      targetCtx.rotate((rotation * Math.PI) / 180);
      targetCtx.scale(scale, scale);
      targetCtx.drawImage(
        source,
        -sourceWidth / 2,
        -sourceHeight / 2,
        sourceWidth,
        sourceHeight
      );
      targetCtx.restore();
    }

    function calculateOtsuThreshold(values) {
      const histogram = new Uint32Array(256);
      let total = 0;
      let sum = 0;

      for (let i = 0; i < values.length; i += 4) {
        const value = values[i];
        histogram[value] += 1;
        total += 1;
        sum += value;
      }

      let sumBackground = 0;
      let weightBackground = 0;
      let maxVariance = -1;
      let bestThreshold = 96;

      for (let threshold = 0; threshold < 256; threshold += 1) {
        weightBackground += histogram[threshold];
        if (weightBackground === 0) continue;

        const weightForeground = total - weightBackground;
        if (weightForeground === 0) break;

        sumBackground += threshold * histogram[threshold];

        const meanBackground =
          sumBackground / weightBackground;
        const meanForeground =
          (sum - sumBackground) / weightForeground;

        const varianceBetween =
          weightBackground *
          weightForeground *
          (meanBackground - meanForeground) ** 2;

        if (varianceBetween > maxVariance) {
          maxVariance = varianceBetween;
          bestThreshold = threshold;
        }
      }

      return bestThreshold;
    }

    function erodeBinaryMask(radius = 1) {
      erodedMaskCtx.save();
      erodedMaskCtx.setTransform(1, 0, 0, 1, 0, 0);
      erodedMaskCtx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
      erodedMaskCtx.drawImage(binaryMaskCanvas, 0, 0);

      erodedMaskCtx.globalCompositeOperation = "destination-in";

      const shifts = [
        [-radius, 0],
        [radius, 0],
        [0, -radius],
        [0, radius],
      ];

      for (const [dx, dy] of shifts) {
        erodedMaskCtx.drawImage(binaryMaskCanvas, dx, dy);
      }

      erodedMaskCtx.restore();
    }

    function makeBinaryMask() {
      const maskImage = binaryMaskCtx.getImageData(
        0,
        0,
        FRAME_SIZE,
        FRAME_SIZE
      );

      const data = maskImage.data;
      const pixelCount = FRAME_SIZE * FRAME_SIZE;
      const luminance = new Uint8ClampedArray(pixelCount);
      const alpha = new Uint8ClampedArray(pixelCount);

      let lumaMin = 255;
      let lumaMax = 0;
      let alphaMin = 255;
      let alphaMax = 0;

      /*
        關鍵修正：
        MediaPipe segmentationMask 在不同瀏覽器／GPU 上，
        可能把人物信心值放在：
        1. RGB 灰階，或
        2. Alpha 通道。

        v8 只讀 RGB；若該手機把遮罩放在 Alpha，
        RGB 會全部接近 0，程式就把整張人物刪掉，畫面因此全黑。
      */
      for (let p = 0, i = 0; i < data.length; i += 4, p += 1) {
        const luma = Math.round(
          (data[i] + data[i + 1] + data[i + 2]) / 3
        );
        const a = data[i + 3];

        luminance[p] = luma;
        alpha[p] = a;

        lumaMin = Math.min(lumaMin, luma);
        lumaMax = Math.max(lumaMax, luma);
        alphaMin = Math.min(alphaMin, a);
        alphaMax = Math.max(alphaMax, a);
      }

      const lumaRange = lumaMax - lumaMin;
      const alphaRange = alphaMax - alphaMin;

      let confidence;
      if (alphaRange >= 24 && alphaRange > lumaRange * 1.15) {
        confidence = alpha;
        lastMaskChannel = "alpha";
      } else if (lumaRange >= 12) {
        confidence = luminance;
        lastMaskChannel = "RGB";
      } else if (alphaRange >= 8) {
        confidence = alpha;
        lastMaskChannel = "alpha-fallback";
      } else {
        /*
          遮罩尚未就緒。不要輸出全透明黑畫面，
          先回報無效，onResults 會暫時顯示原始相機。
        */
        lastMaskChannel = "invalid";
        lastMaskCoverage = 0;
        return false;
      }

      const otsu = calculateOtsuThreshold(confidence);
      const threshold = Math.max(
        70,
        Math.min(165, otsu + 10)
      );

      let foregroundCount = 0;

      for (let p = 0, i = 0; i < data.length; i += 4, p += 1) {
        const solid = confidence[p] >= threshold ? 255 : 0;
        if (solid) foregroundCount += 1;

        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = solid;
      }

      lastMaskCoverage = foregroundCount / pixelCount;

      /*
        面積極端時代表遮罩判斷失敗。
        不要顯示黑畫面，也不要把整個背景當人物。
      */
      if (
        lastMaskCoverage < 0.002 ||
        lastMaskCoverage > 0.94
      ) {
        lastMaskChannel += "-invalid-coverage";
        return false;
      }

      binaryMaskCtx.putImageData(maskImage, 0, 0);
      erodeBinaryMask(1);
      return true;
    }

    async function initSegmentation() {
      if (!window.SelfieSegmentation) {
        throw new Error(
          "MediaPipe Selfie Segmentation 尚未載入，請檢查網路或 CDN。"
        );
      }

      segmentation = new SelfieSegmentation({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
      });

      segmentation.setOptions({
        modelSelection: 1,
        selfieMode: false,
      });

      segmentation.onResults((results) => {
        const sourceSize = getSourceSize(results.image);
        const rotation = getRequiredRotation(
          sourceSize.width,
          sourceSize.height
        );

        drawOrientedContain(
          orientedImageCtx,
          results.image,
          sourceSize.width,
          sourceSize.height,
          rotation
        );

        drawOrientedContain(
          binaryMaskCtx,
          results.segmentationMask,
          sourceSize.width,
          sourceSize.height,
          rotation
        );

        const maskReady = makeBinaryMask();

        /*
          遮罩還沒準備好時，手機先顯示原始相機畫面，
          避免使用者只看到烏漆媽黑。
        */
        if (!maskReady) {
          if (
            previewCanvas.width !== FRAME_SIZE ||
            previewCanvas.height !== FRAME_SIZE
          ) {
            previewCanvas.width = FRAME_SIZE;
            previewCanvas.height = FRAME_SIZE;
          }

          previewCtx.save();
          previewCtx.setTransform(1, 0, 0, 1, 0, 0);
          previewCtx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
          previewCtx.drawImage(orientedImageCanvas, 0, 0);
          previewCtx.restore();

          setMobileStatus(
            `相機正常；人物遮罩初始化中（${lastMaskChannel}）`
          );
          frameBusy = false;
          return;
        }

        /*
          使用有效遮罩裁出人物。
        */
        transportRgbCtx.save();
        transportRgbCtx.setTransform(1, 0, 0, 1, 0, 0);
        transportRgbCtx.clearRect(
          0,
          0,
          FRAME_SIZE,
          FRAME_SIZE
        );
        transportRgbCtx.drawImage(orientedImageCanvas, 0, 0);
        transportRgbCtx.globalCompositeOperation =
          "destination-in";
        transportRgbCtx.drawImage(erodedMaskCanvas, 0, 0);
        transportRgbCtx.restore();

        // 手機預覽直接顯示已清除白邊的 RGB。
        if (
          previewCanvas.width !== FRAME_SIZE ||
          previewCanvas.height !== FRAME_SIZE
        ) {
          previewCanvas.width = FRAME_SIZE;
          previewCanvas.height = FRAME_SIZE;
        }

        previewCtx.save();
        previewCtx.setTransform(1, 0, 0, 1, 0, 0);
        previewCtx.clearRect(
          0,
          0,
          FRAME_SIZE,
          FRAME_SIZE
        );
        previewCtx.drawImage(transportRgbCanvas, 0, 0);
        previewCtx.restore();

        /*
          左半：已用侵蝕遮罩裁切的 RGB
          右半：侵蝕後的黑白遮罩
        */
        sendCtx.setTransform(1, 0, 0, 1, 0, 0);
        sendCtx.fillStyle = "#000";
        sendCtx.fillRect(
          0,
          0,
          sendCanvas.width,
          sendCanvas.height
        );
        sendCtx.drawImage(transportRgbCanvas, 0, 0);
        sendCtx.drawImage(
          erodedMaskCanvas,
          FRAME_SIZE,
          0
        );

        if (!status.textContent.includes("連線")) {
          setMobileStatus(
            `人物辨識正常（${lastMaskChannel}，${Math.round(
              lastMaskCoverage * 100
            )}%）`
          );
        }

        frameBusy = false;
      });

      await segmentation.initialize();
    }

    async function frameLoop() {
      if (!running) return;

      if (!frameBusy && video.readyState >= 2) {
        frameBusy = true;

        try {
          await segmentation.send({ image: video });
        } catch (error) {
          frameBusy = false;
          running = false;
          setMobileStatus("去背：failed");
          showError(
            error,
            "#errorBox",
            "MediaPipe 人物去背失敗"
          );
          return;
        }
      }

      requestAnimationFrame(frameLoop);
    }

    async function connectToScreen() {
      if (!room) {
        setMobileStatus("相機成功；未指定大螢幕房間");
        return;
      }

      setMobileStatus("連線：建立 PeerJS");
      peer = await createPeer();

      if (typeof sendCanvas.captureStream !== "function") {
        const error = new Error(
          "此瀏覽器不支援 canvas.captureStream，無法傳送去背人物。"
        );
        error.name = "NotSupportedError";
        throw error;
      }

      outputStream = sendCanvas.captureStream(15);
      call = peer.call(room, outputStream);

      if (!call) {
        throw new Error("無法建立 WebRTC 通話。");
      }

      call.on("stream", () => {
        setMobileStatus("連線：成功");
      });

      call.on("close", () => {
        setMobileStatus("連線：大螢幕已離線");
      });

      call.on("error", (error) => {
        setMobileStatus("連線：failed");
        showError(
          error,
          "#errorBox",
          "手機 WebRTC 通話錯誤"
        );
      });

      setTimeout(() => {
        if (status.textContent.includes("建立")) {
          setMobileStatus("連線：已送出不透明人物");
        }
      }, 1500);

      peer.on("error", (error) => {
        setMobileStatus("連線：failed");
        showError(error, "#errorBox", "PeerJS 錯誤");
      });
    }

    async function startCamera() {
      if (starting) return;
      starting = true;

      startBtn.disabled = true;
      startBtn.textContent = "啟動中…";
      $("#errorBox").classList.add("hidden");
      setMobileStatus("正在請求相機權限…");

      try {
        cameraStream = await getCameraStream(facingMode);
        video.srcObject = cameraStream;
        await video.play();

        setMobileStatus("相機成功，正在初始化人物去背…");
        await initSegmentation();

        running = true;
        frameLoop();
        switchBtn.disabled = false;
        startLayer.classList.add("hidden");
        setMobileStatus("相機：成功");

        try {
          await connectToScreen();
        } catch (connectionError) {
          setMobileStatus("相機成功；連線 failed");
          showError(
            connectionError,
            "#errorBox",
            "手機連接大螢幕失敗"
          );
        }
      } catch (error) {
        setMobileStatus("啟動：failed");
        showError(
          error,
          "#errorBox",
          "手機相機啟動失敗"
        );
        startBtn.disabled = false;
        startBtn.textContent = "重新開啟相機";
      } finally {
        starting = false;
      }
    }

    async function switchCamera() {
      switchBtn.disabled = true;
      facingMode =
        facingMode === "user"
          ? "environment"
          : "user";

      try {
        cameraStream
          ?.getTracks()
          .forEach((track) => track.stop());

        cameraStream = await getCameraStream(facingMode);
        video.srcObject = cameraStream;
        await video.play();

        setMobileStatus(
          `鏡頭：${
            facingMode === "user"
              ? "前鏡頭"
              : "後鏡頭"
          }`
        );
      } catch (error) {
        setMobileStatus("切換鏡頭：failed");
        showError(
          error,
          "#errorBox",
          "切換鏡頭失敗"
        );
      } finally {
        switchBtn.disabled = false;
      }
    }

    function handleOrientationChange() {
      const orientationLabel =
        window.innerWidth > window.innerHeight
          ? "橫向"
          : "直向";

      if (orientationLabel === lastOrientationLabel) {
        return;
      }

      lastOrientationLabel = orientationLabel;

      if (running) {
        setMobileStatus(
          `手機已切換${orientationLabel}，下一幀會同步旋轉`
        );
      }
    }

    startBtn.addEventListener("click", (event) => {
      event.preventDefault();
      void startCamera();
    });

    switchBtn.addEventListener("click", (event) => {
      event.preventDefault();
      void switchCamera();
    });

    window.addEventListener(
      "orientationchange",
      handleOrientationChange
    );
    window.addEventListener(
      "resize",
      handleOrientationChange
    );
    screen.orientation?.addEventListener?.(
      "change",
      handleOrientationChange
    );

    window.addEventListener("beforeunload", () => {
      running = false;
      cameraStream
        ?.getTracks()
        .forEach((track) => track.stop());
      outputStream
        ?.getTracks()
        .forEach((track) => track.stop());
      call?.close();
      peer?.destroy();
      segmentation?.close?.();
    });
  }



  window.addEventListener("error", (event) => {
    console.error("Unhandled window error", event.error || event.message);
    const box = document.querySelector("#errorBox");
    if (box && event.error) {
      showError(event.error, "#errorBox", "未捕捉的 JavaScript 錯誤");
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection", event.reason);
    const box = document.querySelector("#errorBox");
    if (box) {
      showError(event.reason, "#errorBox", "未捕捉的 Promise 錯誤");
    }
  });

  if (mode === "screen") {
    renderScreen();
  } else if (mode === "mobile") {
    renderMobile();
  } else if (mode === "officialtest") {
    renderOfficialTest();
  } else {
    renderHome();
  }
})();

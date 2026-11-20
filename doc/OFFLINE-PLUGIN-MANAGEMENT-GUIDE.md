# 離線與封閉網路環境下 Paperclip 外掛集中管理與 UI 安裝指南

本文件說明如何在**無外部網際網路連線（Air-gapped / 隔離網路）**的 Linux 伺服器（RHEL / CentOS / Rocky / Ubuntu / Debian）上，建立統一的共用外掛收容倉庫（預設為 `/data/paperclip/shared/plugins`），並透過 Paperclip Web UI 達成卡片式一鍵連線安裝與無縫版本更新。

---

## 1. 架構原理與優勢

Paperclip 內建外掛自動發現機制（`discoverBundledPlugins`）。當服務啟動或瀏覽外掛頁面時，系統會自動遞迴掃描 `/app/packages/plugins` 目錄下的所有子資料夾。

透過將宿主機的集中目錄掛載至容器內，可達成以下優勢：
- **無需內部架設 npm 伺服器**：免除額外維運 Verdaccio / Nexus 等服務。
- **一次放置，多實例共享**：主機上部署多套 Paperclip 服務實例時，共用同一份外掛目錄。
- **免指令，UI 直接安裝**：管理員在 Web UI（Plugin Manager）直接點擊【Install】按鈕即可完成安裝。
- **自包含（Self-contained）**：外掛在連網建置機上預編譯完成，離線環境無須安裝編譯器或構建工具。

```
+-----------------------------------------------------------------------------------+
| RHEL / Linux 宿主機 (/data/paperclip)                                              |
|                                                                                   |
|  [ 集中收容倉庫 ]                                                                  |
|  /data/paperclip/shared/plugins/                                                  |
|    ├── plugin-llm-wiki/       (含 package.json, dist/, src/)                       |
|    └── custom-crm-connector/  (含 package.json, dist/, src/)                       |
|          │                                                                        |
|          │ (以唯讀方式掛載 :ro,z)                                                  |
|          ├──────────────────────────────────┐                                     |
|          ▼                                  ▼                                     |
|  [ 實例 A 容器 ]                    [ 實例 B 容器 ]                                 |
|  /app/packages/plugins/custom/      /app/packages/plugins/custom/                 |
|          │                                  │                                     |
|          ▼                                  ▼                                     |
|  Web UI (Port 3101)                 Web UI (Port 3102)                            |
|  【Available Plugins ➔ Install】    【Available Plugins ➔ Install】               |
+-----------------------------------------------------------------------------------+
```

---

## 2. 階段一：外網建置機 —— 外掛編譯與自包含打包

外掛進入離線環境前，必須在具備外網環境的開發機/建置機完成編譯。

### 2.1 外掛必備結構標準
一個標準的 Paperclip 自包含外掛目錄結構如下：
```text
<外掛目錄名稱>/
├── package.json          # 必須具備 paperclipPlugin 欄位定義
├── dist/                 # 編譯產物
│   ├── manifest.js       # 外掛定義與能力清單 (必備)
│   ├── worker.js         # 背景邏輯與事件處理 (必備)
│   └── ui/               # 前端組件 (若有宣告 UI slot)
├── src/
│   └── manifest.ts       # 原始定義檔 (供 UI 提取 displayName 與描述文字)
└── migrations/           # 資料庫遷移腳本 (選用，若外掛有專屬 DB namespace)
```

`package.json` 必須包含 `paperclipPlugin` 進入點宣告：
```json
{
  "name": "@paperclipai/plugin-llm-wiki",
  "version": "0.1.0",
  "paperclipPlugin": {
    "manifest": "./dist/manifest.js",
    "worker": "./dist/worker.js",
    "ui": "./dist/ui/"
  }
}
```

### 2.2 打包腳本範例

在 Paperclip 專案根目錄執行以下步驟：

```bash
# 1. 編譯欲打包的外掛（以 plugin-llm-wiki 為例）
pnpm --filter @paperclipai/plugin-llm-wiki build

# 2. 確認產物存在
test -f packages/plugins/plugin-llm-wiki/dist/manifest.js || { echo "編譯失敗"; exit 1; }

# 3. 打包外掛為 tar.gz
tar -czvf plugin-llm-wiki-bundle.tar.gz \
  -C packages/plugins plugin-llm-wiki
```

---

## 3. 階段二：離線主機 —— 建立 `/data/` 共用目錄與部署

將打包產生的 `plugin-*-bundle.tar.gz` 傳送至目標主機。

### 3.1 建立目錄結構

```bash
# 建立共用外掛倉庫目錄
sudo mkdir -p /data/paperclip/shared/plugins

# 將外掛解壓至共用目錄
sudo tar -xzvf plugin-llm-wiki-bundle.tar.gz -C /data/paperclip/shared/plugins/

# 配置檔案權限（Paperclip 容器內以 node 帳號 UID 1000 運行）
sudo chown -R 1000:1000 /data/paperclip/shared/plugins
sudo chmod -R 755 /data/paperclip/shared/plugins
```

完成後的目錄應呈現：
```text
/data/paperclip/shared/plugins/
└── plugin-llm-wiki/
    ├── package.json
    ├── dist/
    │   ├── manifest.js
    │   └── worker.js
    └── src/
        └── manifest.ts
```

---

## 4. 階段三：容器掛載配置

在各實例啟動設定中，將主機目錄掛載至容器內的 `/app/packages/plugins/custom`。

### 4.1 Docker Compose 配置範例 (`docker-compose.yml`)

```yaml
services:
  server:
    image: paperclip:custom-v1
    restart: unless-stopped
    ports:
      - "3100:3100"
    environment:
      DATABASE_URL: postgres://paperclip:password@db:5432/paperclip
      PORT: "3100"
      SERVE_UI: "true"
      PAPERCLIP_DEPLOYMENT_MODE: "authenticated"
      PAPERCLIP_DEPLOYMENT_EXPOSURE: "private"
      PAPERCLIP_PUBLIC_URL: "http://<主機IP>:3100"
      BETTER_AUTH_SECRET: "your-better-auth-secret-here"
      PAPERCLIP_TOOL_ACTION_SIGNING_SECRET: "your-signing-secret-here"
    volumes:
      # 實例專屬工作區與檔案資料
      - ./data/paperclip:/paperclip:Z
      # 主機共用外掛目錄 (唯讀 + SELinux 共享標籤)
      - /data/paperclip/shared/plugins:/app/packages/plugins/custom:ro,z
    depends_on:
      - db
```

> **SELinux 標籤提示**：
> - `./data/paperclip:/paperclip:Z`：大寫 `Z` 為容器專屬私有標籤。
> - `/data/paperclip/shared/plugins:...:ro,z`：小寫 `z` 允許**多個容器共同存取**同一宿主機目錄，且 `:ro` 確保外掛程式碼不被容器更動。

### 4.2 Podman / Docker CLI 執行指令

```bash
podman run -d \
  --name paperclip-app \
  -p 3100:3100 \
  -v /data/paperclip/shared/plugins:/app/packages/plugins/custom:ro,z \
  -v /data/paperclip/instances/instance-a/data/paperclip:/paperclip:Z \
  --env-file .env \
  paperclip:custom-v1
```

---

## 5. 階段四：Web UI 安裝與啟用

當容器啟動後，即可透過瀏覽器連線進行圖形化管理：

1. 開啟瀏覽器訪問 Paperclip（如 `http://<主機IP>:3100`）。
2. 以管理員身分登入後，點擊左下方 **Settings（設定）** ➔ **Plugin Manager（外掛管理）**。
3. 滾動至 **Available Plugins (Bundled)** 區塊：
   - 系統已自動偵測到 `/data/paperclip/shared/plugins` 下收容的所有外掛。
   - 畫面上會顯示外掛名稱、描述與標籤，初始狀態為 `Not installed`。
4. 點擊卡片右側的 **【Install】** 按鈕：
   - Paperclip 會直接讀取預編譯好的 `dist/manifest.js`。
   - 若該外掛有包含資料庫變更（`migrations/`），系統會自動執行遷移。
5. 安裝完成後，狀態立即轉換為綠色 **`ready`**，相關頁面功能或導航側邊欄會即時呈現。

---

## 6. 階段五：日常維運與版本更新 SOP

### 6.1 更新現有外掛

當外掛發布新版本修復問題時：

1. **在外網建置機重新編譯**並產出新版壓縮包。
2. **傳送並解壓覆蓋**至離線主機的目錄：
   ```bash
   sudo tar -xzvf plugin-llm-wiki-v2.tar.gz -C /data/paperclip/shared/plugins/
   sudo chown -R 1000:1000 /data/paperclip/shared/plugins
   ```
3. **在 UI 重新啟用**：
   進入 **Plugin Manager** 頁面，找到該外掛點擊 **【Disable】** 後再點擊 **【Enable】**（或者直接重啟容器 `podman restart <container_id>`），系統即會載入新版 Worker 與 UI。

### 6.2 移除外掛

在 UI 的 **Installed Plugins** 清單中，點擊垃圾桶圖示進行 **Uninstall**。解除安裝後若要徹底從系統可用清單移除，直接自 `/data/paperclip/shared/plugins/` 刪除該外掛資料夾即可。

---

## 7. 常見問題與排錯 (FAQ)

### Q1: 在 UI 點擊 Install 時提示 `Failed to auto-build bundled local plugin`？
- **原因**：外掛缺少 `dist/manifest.js` 或 `dist/worker.js`，Paperclip 試圖在離線容器內執行 `pnpm build`，但容器內缺少編譯環境。
- **解法**：確認在外網機器有確實執行 `pnpm build`，且上傳的目錄內包含完整的 `dist/` 資料夾。

### Q2: 容器啟動後 UI 的「Available Plugins」沒有出現外掛？
1. 確認主機目錄掛載路徑是否正確（必須掛載至容器內的 `/app/packages/plugins/custom` 或 `/app/packages/plugins/<子目錄>`）。
2. 檢查 `package.json` 是否包含正確的 `"paperclipPlugin"` 物件宣告。
3. 檢查 SELinux 權限，確認掛載參數有加上 `:z`。
4. 執行檢查命令：
   ```bash
   podman exec -it paperclip-app ls -la /app/packages/plugins/custom
   ```
   確認容器內部能正常讀取該目錄。

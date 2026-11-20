# RHEL 8 離線環境多實例部署與自訂映像檔打包指南

本文件提供在 **Red Hat Enterprise Linux 8 (RHEL 8)** 離線（Air-gapped / 無外部連線）主機上，部署**多套修改後 Paperclip 服務**的完整架構指南與操作手冊。

---

## 目錄

1. [架構總覽（直連 Port 模式 vs. Nginx 模式）](#1-架構總覽直連-port-模式-vs-nginx-模式)
2. [階段一：自訂程式碼打包與映像檔匯出（連網建置機）](#2-階段一自訂程式碼打包與映像檔匯出連網建置機)
3. [階段二：RHEL 8 離線主機前置準備](#3-階段二rhel-8-離線主機前置準備)
4. [階段三：多套服務實例化規劃與部署（直連模式為預設）](#4-階段三多套服務實例化規劃與部署直連模式為預設)
5. [階段四：反向代理配置（Nginx，選用 / Optional）](#5-階段四反向代理配置nginx選用--optional)
6. [階段五：維運與離線環境關鍵注意事項](#6-階段五維運與離線環境關鍵注意事項)

---

## 1. 架構總覽（直連 Port 模式 vs. Nginx 模式）

在無外網連線的 RHEL 8 主機上，多套 Paperclip 服務有兩種常見的網路接入架構：

### 模式 A：獨立 Port 直連存取（預設推薦，免 Nginx）
最簡單直接的部署方式。每套 Paperclip 實例各自監聽主機上的不同連接埠（如 `3101`、`3102`），使用者直接連線至 `http://<主機IP>:3101` 與 `http://<主機IP>:3102`：

```
+-------------------------------------------------------------------------+
|                              RHEL 8 主機                                 |
|                                                                         |
|  客戶端直接連線 (http://<主機IP>:3101)                                    |
|        │                                                                |
|        ▼                                                                |
|  [ Paperclip 實例 A (Port 3101) ] ───► [ PostgreSQL A (容器內部通訊) ]   |
|                                                                         |
|  客戶端直接連線 (http://<主機IP>:3102)                                    |
|        │                                                                |
|        ▼                                                                |
|  [ Paperclip 實例 B (Port 3102) ] ───► [ PostgreSQL B (容器內部通訊) ]   |
+-------------------------------------------------------------------------+
```

### 模式 B：透過 Nginx 反向代理（選用 / 可隨時後續擴充）
若未來有統一名稱解析（Domain Name）、SSL 憑證卸載（HTTPS）或統一開通防火牆 80/443 的需求，可在前端加掛 Nginx。若目前環境不需要，**完全可以略過 Nginx，直接採用模式 A**。

- **容器引擎**：使用 RHEL 8 原生支援的 **Podman**（或 Docker CE）。
- **實例隔離**：每套服務擁有獨立的設定檔（`.env`）、資料目錄及 PostgreSQL 容器。

---

## 2. 階段一：自訂程式碼打包與映像檔匯出（連網建置機）

此步驟需在**具備外網連線能力**的建置機（開發筆電或 CI/CD Runner）上執行。

### 2.1 打包前本機校驗

若你有修改程式碼或相依套件：

1. **依賴同步**：若修改了 `package.json`，必須更新鎖定檔（Dockerfile 編譯時會嚴格比對）：
   ```bash
   pnpm install
   ```
2. **語法與編譯確認**：
   ```bash
   pnpm -r typecheck
   pnpm build
   ```

### 2.2 建置自訂映像檔

在專案**根目錄**執行建置（請特別注意 `--platform` 與 `--target` 參數）：

```bash
DOCKER_BUILDKIT=1 docker build \
  --platform linux/amd64 \
  --target production \
  --build-arg PAPERCLIP_BUILD_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "custom-build") \
  -t paperclip:custom-v1 \
  -f Dockerfile .
```

> **重要參數說明**：
> - `--platform linux/amd64`：若建置機為 macOS (Apple Silicon M系列)，必須指定此參數跨平台編譯為 x86_64 架構，否則在 RHEL 8 x86_64 上會報 `exec format error`。
> - `--target production`：指定只建置自託管正式環境（避免額外打包 Managed Cloud 的依賴）。
> - `--build-arg PAPERCLIP_BUILD_COMMIT=...`：將當前 Git Commit 寫入 build-info，供系統識別版本。

### 2.3 下載資料庫映像檔並打包匯出

```bash
# 1. 抓取對應版本之 PostgreSQL 映像檔
docker pull postgres:17-alpine

# 2. 將 Paperclip 與 PostgreSQL 映像檔打包成單一 tar.gz
docker save paperclip:custom-v1 postgres:17-alpine | gzip > paperclip-offline-bundle.tar.gz
```

---

## 3. 階段二：RHEL 8 離線主機前置準備

將 `paperclip-offline-bundle.tar.gz` 透過內部跳板機、隨身碟或內部檔案伺服器傳送至 RHEL 8 主機。

### 3.1 匯入映像檔

在 RHEL 8 主機上執行：

```bash
# 若使用 Podman (RHEL 8 預設推薦)
podman load -i paperclip-offline-bundle.tar.gz

# 若使用 Docker
docker load -i paperclip-offline-bundle.tar.gz

# 驗證映像檔已成功載入
podman images
```

### 3.2 SELinux 與防火牆配置

RHEL 8 預設強制啟用 SELinux 與 firewalld：

1. **防火牆開通**：
   - **直連 Port 模式（不使用 Nginx，推薦簡易環境）**：
     請直接開通各實例規劃的連接埠（例如 3101、3102）：
     ```bash
     sudo firewall-cmd --permanent --add-port=3101/tcp
     sudo firewall-cmd --permanent --add-port=3102/tcp
     sudo firewall-cmd --reload
     ```
   - **Nginx 反向代理模式（選用）**：
     若有使用 Nginx，僅需開啟 80 / 443：
     ```bash
     sudo firewall-cmd --permanent --add-service=http
     sudo firewall-cmd --permanent --add-service=https
     sudo firewall-cmd --reload
     ```

2. **SELinux 標籤**：
   容器掛載本機資料夾時，必須加上 `:Z`（私有未共享標籤）或 `:z`（共享標籤），否則容器內部讀寫資料夾時會出現 `Permission Denied`。

---

## 4. 階段三：多套服務實例化規劃與部署（直連模式為預設）

在主機上統一於 `/data/` 底下建立結構化的目錄層次（以 `/data/paperclip` 為基準，並包含共用外掛倉庫）：

```text
/data/paperclip/
├── shared/
│   └── plugins/               # 【共用外掛集中收容倉庫】各實例共享掛載
│       ├── plugin-llm-wiki/
│       └── ...
└── instances/
    ├── instance-team-a/       # 實例 A (Team A)
    │   ├── .env
    │   ├── docker-compose.yml
    │   └── data/
    │       ├── paperclip/
    │       └── pgdata/
    └── instance-team-b/       # 實例 B (Team B)
        ├── .env
        ├── docker-compose.yml
        └── data/
            ├── paperclip/
            └── pgdata/
```

> 註：
> 1. 主機統一建立於 `/data/paperclip/`，方便在獨立磁碟分區掛載與進行集中快照備份。
> 2. `shared/plugins/` 統一收容預編譯好的外掛，供主機上所有 Paperclip 實例掛載，可在 Web UI 達到一鍵安裝/啟用。
> 3. 若日後有需要使用 Nginx，可再於 `/data/paperclip/nginx/` 補充反向代理設定。

### 4.0 基礎目錄建立與權限配置

在 RHEL 8 主機上建立全域目錄與設定權限：

```bash
# 建立各目錄
sudo mkdir -p /data/paperclip/shared/plugins
sudo mkdir -p /data/paperclip/instances/instance-team-a/data/{paperclip,pgdata}
sudo mkdir -p /data/paperclip/instances/instance-team-b/data/{paperclip,pgdata}

# 設定容器內部 node 帳號 (UID 1000) 之讀寫權限
sudo chown -R 1000:1000 /data/paperclip
sudo chmod -R 755 /data/paperclip
```

### 4.1 實例 A 配置範例

進入 `/data/paperclip/instances/instance-team-a/`：

#### 1. 建立 `.env`
```bash
# 生成專屬隨機密鑰
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
SIGNING_SECRET=$(openssl rand -hex 32)
```

寫入 `.env`：
```ini
COMPOSE_PROJECT_NAME=paperclip-teama
PAPERCLIP_PORT=3101
POSTGRES_PORT=5433
POSTGRES_USER=paperclip
POSTGRES_PASSWORD=SecurePassword_TeamA_123
POSTGRES_DB=paperclip_teama

# 【直連模式】請填寫主機 IP 或局域網主機名稱 + 連接埠 (例: http://192.168.1.100:3101)
PAPERCLIP_PUBLIC_URL=http://<主機IP>:3101
# 【若使用 Nginx 模式】則填寫網域名稱 (例: http://teama.paperclip.internal)

BETTER_AUTH_SECRET=填入上述生成的隨機字串
PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=填入上述生成的隨機字串
```

#### 2. 建立 `docker-compose.yml`
```yaml
services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 5
    volumes:
      - ./data/pgdata:/var/lib/postgresql/data:Z

  server:
    image: paperclip:custom-v1
    restart: unless-stopped
    pids_limit: 2048
    stop_grace_period: 90s
    ports:
      # 直連模式：直接對外開放 host port（綁定 0.0.0.0）
      - "${PAPERCLIP_PORT}:3100"
      # 若日後使用 Nginx 反向代理，可改為僅綁定本機 127.0.0.1：
      # - "127.0.0.1:${PAPERCLIP_PORT}:3100"
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      PORT: "3100"
      SERVE_UI: "true"
      PAPERCLIP_DEPLOYMENT_MODE: "authenticated"
      PAPERCLIP_DEPLOYMENT_EXPOSURE: "private"
      PAPERCLIP_PUBLIC_URL: "${PAPERCLIP_PUBLIC_URL}"
      BETTER_AUTH_SECRET: "${BETTER_AUTH_SECRET}"
      PAPERCLIP_TOOL_ACTION_SIGNING_SECRET: "${PAPERCLIP_TOOL_ACTION_SIGNING_SECRET}"
    volumes:
      # 實例專屬工作區與檔案資料庫 (私有 Z 標籤)
      - ./data/paperclip:/paperclip:Z
      # 主機統一共用外掛倉庫 (唯讀 + 共享 z 標籤，供多實例共用)
      - /data/paperclip/shared/plugins:/app/packages/plugins/custom:ro,z
    depends_on:
      db:
        condition: service_healthy
```

### 4.2 實例 B 配置
重複上述步驟至 `/data/paperclip/instances/instance-team-b/`，修改：
- `COMPOSE_PROJECT_NAME=paperclip-teamb`
- `PAPERCLIP_PORT=3102`
- `POSTGRES_PORT=5434`
- 獨立的 `POSTGRES_DB`、密碼與 `BETTER_AUTH_SECRET`
- `PAPERCLIP_PUBLIC_URL=http://<主機IP>:3102`

### 4.3 啟動實例

```bash
# 啟動實例 A
cd /data/paperclip/instances/instance-team-a
podman-compose up -d
# (若使用 Docker: docker compose up -d)

# 啟動實例 B
cd /data/paperclip/instances/instance-team-b
podman-compose up -d
```

啟動後即可直接在瀏覽器訪問：
- 實例 A：`http://<主機IP>:3101`
- 實例 B：`http://<主機IP>:3102`

---

## 5. 階段四：反向代理配置（Nginx，選用 / Optional）

> ⚠️ **提示**：此步驟為**選用（Optional）**項目。若目前環境直接使用各實例的獨立 Port（如 `http://<主機IP>:3101`），**可直接略過本章節**，直接前往 [階段五：維運與離線環境關鍵注意事項](#6-階段五維運與離線環境關鍵注意事項)。

若未來有統一網域（Domain Name）或集中配置 SSL 憑證的需求，再安裝 Nginx 並建立 `/etc/nginx/conf.d/paperclip.conf`：

```nginx
# 實例 A: 團隊 A
server {
    listen 80;
    server_name teama.paperclip.internal;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;

        # WebSocket / SSE 串流支援 (Heartbeat 與日誌必備)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}

# 實例 B: 團隊 B
server {
    listen 80;
    server_name teamb.paperclip.internal;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3102;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

重載 Nginx：
```bash
sudo nginx -t && sudo systemctl reload nginx
```

> **SELinux 備忘**：若 Nginx 連線到本機埠口被阻擋（`502 Bad Gateway`），需允許 Nginx 連接網路：
> ```bash
> sudo setsebool -P httpd_can_network_connect 1
> ```

---

## 6. 階段五：維運與離線環境關鍵注意事項

### 6.1 LLM 連線方案（重要核心相依）
Paperclip 本身是 AI Agent 的控制平台。若主機完全無法連外網，Agent 將無法呼叫外部 API（如 OpenAI、Claude 等）。
必須具備以下配套措施之一：
1. **內部部署本機大模型**：在內網 GPU 主機上運行 **vLLM**、**Ollama** 或 **TGI**，並提供相容 OpenAI 格式的 API endpoint。
2. **白名單 Forward Proxy**：若企業內部有受管制的代理伺服器（Proxy），可於容器環境變數加入：
   ```ini
   HTTP_PROXY=http://proxy.internal.corp:8080
   HTTPS_PROXY=http://proxy.internal.corp:8080
   NO_PROXY=localhost,127.0.0.1,db,.internal
   ```

### 6.2 開機自啟動管理（Systemd 整合）
若希望伺服器開機時各套服務能自動啟動，可為每個實例建立 systemd 服務單元：

建立 `/etc/systemd/system/paperclip-teama.service`：
```ini
[Unit]
Description=Paperclip Instance Team A
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/data/paperclip/instances/instance-team-a
ExecStart=/usr/bin/podman-compose up -d
ExecStop=/usr/bin/podman-compose down
TimeoutStartSec=180

[Install]
WantedBy=multi-user.target
```

啟用自啟：
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now paperclip-teama.service
```

### 6.3 資料備份策略
定期將各實例目錄與共用倉庫進行備份：
- `/data/paperclip/shared/plugins/`：共用外掛倉庫。
- `/data/paperclip/instances/<實例名稱>/data/pgdata/`：資料庫完整資料。
- `/data/paperclip/instances/<實例名稱>/data/paperclip/`：Agent 產生的 Workspace、Artifacts 與上傳檔案。

---

## 7. 階段六：共用外掛（Plugins）集中收容與 UI 一鍵安裝

為了讓多套 Paperclip 實例在**無外網環境**下仍能便捷地使用官方或自研外掛（如 `plugin-llm-wiki`、`plugin-workspace-diff`），本架構透過 `/data/paperclip/shared/plugins/` 集中收容，達成 **「一次打包、多實例共享、UI 卡片一鍵安裝」**。

### 7.1 外掛打包流程（連網建置機）

在外網環境執行預編譯與自包含打包：

```bash
# 1. 進入專案根目錄，編譯指定外掛
pnpm --filter @paperclipai/plugin-llm-wiki build

# 2. 打包外掛必要結構（package.json, dist, src, migrations）
tar -czvf plugin-llm-wiki.tar.gz \
  -C packages/plugins plugin-llm-wiki
```

### 7.2 部署外掛至主機共用目錄（RHEL 8 離線主機）

將壓縮檔透過隨身碟或內部跳板機傳送至離線主機：

```bash
# 解壓至統一集中收容目錄
sudo tar -xzvf plugin-llm-wiki.tar.gz -C /data/paperclip/shared/plugins/

# 設定權限供容器讀取
sudo chown -R 1000:1000 /data/paperclip/shared/plugins
sudo chmod -R 755 /data/paperclip/shared/plugins
```

### 7.3 在 Paperclip Web UI 一鍵安裝與啟用

各實例容器已將 `/data/paperclip/shared/plugins` 唯讀掛載至 `/app/packages/plugins/custom`：

1. 開啟任一實例之 Web 介面（如 `http://<主機IP>:3101`）。
2. 進入 **Settings (設定)** ➔ **Plugin Manager (外掛管理)**。
3. 頁面下方的 **Available Plugins (Bundled)** 區塊會自動偵測並列出該目錄下的外掛（顯示為 `Not installed`）。
4. 點擊卡片右側的 **【Install】** 按鈕。
5. 系統會自動讀取 `dist/manifest.js` 並執行資料庫遷移，完成後狀態立即變更為綠色 **`ready`**！

### 7.4 外掛版本更新與回滾 SOP

- **更新外掛**：新版編譯包直接解壓覆蓋至 `/data/paperclip/shared/plugins/<外掛名稱>`，在 UI 上點擊 **【Disable】** 再 **【Enable】**（或重啟容器）即可無縫完成更新。
- **回滾舊版**：解壓舊版覆蓋回原目錄，重新啟用即可。

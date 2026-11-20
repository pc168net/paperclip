# 企業離線環境開發、快速建置與 RHEL 8 多實例部署標準作業程序 (SOP)

本手冊為在**企業封閉／離線（Air-gapped）環境**下，針對自訂 Paperclip 專案的**建置、打包、交付、驗證與生產級多實例部署**所制定的標準作業規範。

---

## 目錄

- [一、核心架構決策與邊界說明](#一核心架構決策與邊界說明)
- [二、Windows + Podman (WSL2) 建置端調校](#二windows--podman-wsl2-建置端調校)
- [三、映像檔建置標準流程（正式建置 vs. 快速增量建置）](#三映像檔建置標準流程正式建置-vs-快速增量建置)
- [四、離線交付包（Air-gap Release Bundle）規格與校驗](#四離線交付包air-gap-release-bundle規格與校驗)
- [五、RHEL 8 離線主機：生產級多實例部署](#五rhel-8-離線主機生產級多實例部署)
- [六、前端 Nginx 反向代理與 HTTPS 安全架構（生產規範）](#六前端-nginx-反向代理與-https-安全架構生產規範)
- [七、備份、還原與版本回滾 SOP](#七備份還原與版本回滾-sop)
- [八、附錄：暫時性 POC 直連模式說明（非生產）](#八附錄暫時性-poc-直連模式說明非生產)

---

## 一、核心架構決策與邊界說明

### 1. 為何不可在 RHEL 8 採用原生 Node.js 部署？
- **glibc 版本硬限制**：Paperclip 的本地 Runner（`paperclip-runnerd`）採用 Rust 編譯，核心依賴 **GNU libc (glibc) 2.39+**。
- **RHEL 8 系統限制**：RHEL 8 預設且受支援的 glibc 為 **2.28**。若在主機原生執行，控制平面的 Node.js 雖然能勉強啟動，但所有本地 CLI / Agent Runner 將因動態連結失敗而崩潰。
- **結論**：**必須採用容器化（Containerized）部署**。容器基底為 Debian Trixie，自帶 glibc 2.39+，徹底隔離底層 OS 函式庫限制。

### 2. 為何不可在 RHEL 8 離線主機上執行 Build？
- 正式 Dockerfile 包含 `apt-get`、`corepack enable`、`pnpm install`、Rust 工具鏈下載等網路依賴。
- 離線主機無外部鏡像源，強制 build 必然失敗。
- **結論**：**嚴格執行「建置端產出 OCI 映像檔 ➔ 匯出封裝包 ➔ 離線端只做 Load 與 Run」的不可變架構（Immutable Infrastructure）**。

### 3. 為何不使用 `podman-compose` 管理正式服務？
- `podman-compose` 為第三方 Python 封裝，非 RHEL 8 原生保證安裝的元件，且對 `service_healthy` 條件判斷的相容性需實測。
- 正式服務管理推薦使用 **Podman Quadlet**（RHEL 8.8+，需確認 Podman 版本）或 **rootful systemd `podman run` unit**（所有 RHEL 8 版本均支援的回退方案）。
- 兩者均可享有原生的開機啟動、依賴順序管理（`After=`/`Requires=`）與崩潰自動重啟能力。

---

## 二、Windows + Podman (WSL2) 建置端調校

建置端（通常為具備網路或已架設內部 mirror 的 Windows + WSL2 桌機）若效能低落或頻繁中斷，請依照以下步驟優化：

### 1. 消除跨檔案系統 I/O 延遲
- ❌ **嚴禁路徑**：`C:\Users\...` 或 `D:\...`（WSL2 存取 `/mnt/c/` 的 9P 檔案系統跨界效能低落，引發超時）。
- ✅ **正確路徑**：必須將原始碼置於 WSL2 原生 Linux 檔案系統中（如 `/home/<username>/projects/paperclip`）。
- **IDE 開發**：Windows VSCode 請透過 **WSL Extension** 連線至 WSL 內部目錄開發。

### 2. 避免編譯時 OOM 崩潰（Exit Code 137）
在 Windows 個人目錄（`C:\Users\<Windows帳號>\.wslconfig`）設定記憶體上限：
```ini
[wsl2]
memory=12GB       # 建議給予實體記憶體的 60%~70%
swap=8GB          # 確保尖峰編譯有足夠置換空間
processors=4
```
存檔後在 Windows PowerShell 執行：
```powershell
wsl --shutdown
```

---

## 三、映像檔建置標準流程（正式建置 vs. 快速增量建置）

### 流程 A：正式生產映像檔建置（完整乾淨建置）

在具備外部網路或內部完整 Proxy/Registry 的建置機上執行。
**任何**涉及依賴、packages、Runner、adapter、plugin、migration、Dockerfile 或 scripts 的變更，
**必須**使用本流程，不可使用流程 B。

```bash
# 1. 確保相依性鎖定檔一致
pnpm install --frozen-lockfile

# 2. 執行型別與編譯驗證
pnpm -r typecheck
pnpm -r build

# 3. 取得目前 Commit Hash 並產生版本標籤
COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "custom-$(date +%Y%m%d)")
SHORT_HASH=$(echo "${COMMIT_HASH}" | cut -c1-12)
BUILD_DATE=$(date +%Y.%m%d)
IMAGE_TAG="${BUILD_DATE}-${SHORT_HASH}"

# 4. 使用官方正式 Dockerfile 建置 production target
DOCKER_BUILDKIT=1 podman build \
  --platform linux/amd64 \
  --target production \
  --build-arg PAPERCLIP_BUILD_COMMIT="${COMMIT_HASH}" \
  -t "paperclip:${IMAGE_TAG}" \
  -f Dockerfile .

# 5. 同時保留一份 production-base 標籤供日後流程 B 使用
podman tag "paperclip:${IMAGE_TAG}" paperclip:production-base

echo "正式映像已建置完成：paperclip:${IMAGE_TAG}"
```

---

### 流程 B：AI 日常改版「快速增量覆蓋（Fast Overlay）」

> ⚠️ **嚴格適用範圍限制**
>
> 本流程**僅適用於**以下原始碼的變動：
> - `server/src/**/*.ts`
> - `ui/src/**/*.{ts,tsx,css}`
>
> 以下任一變更**必須走流程 A（完整正式建置）**，不得使用本流程：
> - `package.json`、`pnpm-lock.yaml` 或任何依賴變更
> - `packages/*/` 下任何 workspace package（shared、db、adapter-utils 等）
> - `packages/paperclip-runner/`（Runner / Rust 程式碼）
> - `packages/adapters/*`（Agent adapter）
> - `packages/plugins/*`（Plugin）
> - `packages/db/src/schema/*`（Database migration）
> - `Dockerfile`、`scripts/docker-entrypoint.sh`
> - `scripts/` 下被 server build 引用的 runtime 腳本

**前置前提**：本地已成功使用流程 A 建置過 `paperclip:production-base`。

#### 1. 清理舊產物並執行增量編譯

```bash
# 清理上次編譯遺留的產物（防止舊檔案被打入 Image）
pnpm --filter @paperclipai/server clean

# 編譯 UI
pnpm --filter @paperclipai/ui build

# 將 UI 產物同步至 server 實際提供的靜態目錄 server/ui-dist
pnpm --filter @paperclipai/server prepare:ui-dist

# 編譯 Server (含 runner vendor 檢查與 build-stamp 寫入)
pnpm --filter @paperclipai/server build
```

#### 2. 透過 `Dockerfile.fast-overlay` 覆蓋產物

專案根目錄備有 `Dockerfile.fast-overlay`（完整說明與適用範圍限制見該檔案頂部註解）：

```bash
# 產生版本標籤（嚴禁使用 :latest）
COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "custom-$(date +%Y%m%d)")
SHORT_HASH=$(echo "${COMMIT_HASH}" | cut -c1-12)
BUILD_DATE=$(date +%Y.%m%d)
IMAGE_TAG="${BUILD_DATE}-${SHORT_HASH}"

podman build \
  -t "paperclip:${IMAGE_TAG}" \
  -f Dockerfile.fast-overlay .
```

#### 3. 本地 Smoke 測試驗證

```bash
IMAGE_TAG="<填入上一步產生的 IMAGE_TAG>"
EXPECTED_COMMIT="${COMMIT_HASH}"  # 來自上方步驟產生的完整 commit hash
SMOKE_NAME="smoke-test-$$"
SMOKE_VOL=$(mktemp -d)

# 確保無論成功或失敗都會清理測試容器與暫時 volume
cleanup() {
  podman stop "${SMOKE_NAME}" 2>/dev/null || true
  podman rm "${SMOKE_NAME}" 2>/dev/null || true
  rm -rf "${SMOKE_VOL}"
}
trap cleanup EXIT

# 使用暫時 volume 啟動（避免寫入工作區或觸發 embedded DB 副作用）
podman run -d \
  --name "${SMOKE_NAME}" \
  -p 3199:3100 \
  -v "${SMOKE_VOL}:/paperclip:Z" \
  -e BETTER_AUTH_SECRET="smoke-test-secret-must-be-at-least-32-characters-long" \
  "paperclip:${IMAGE_TAG}"

# 等待服務啟動 (最多 30 秒)
echo "等待服務啟動..."
STARTED=false
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3199/api/health >/dev/null 2>&1; then
    STARTED=true
    break
  fi
  sleep 1
done
if [ "${STARTED}" != "true" ]; then
  echo "FAIL: 服務在 30 秒內未啟動"
  podman logs "${SMOKE_NAME}" 2>&1 | tail -30
  exit 1
fi

# 驗證 1：Health endpoint
echo "--- 驗證 health endpoint ---"
HEALTH_RESPONSE=$(curl -fsS http://localhost:3199/api/health) || { echo "FAIL: /api/health 無法回應"; exit 1; }
echo "Health response: ${HEALTH_RESPONSE}"

# 驗證 2：UI 靜態資源（確認新 UI 已被正確服務）
echo "--- 驗證 UI 靜態資源 ---"
UI_STATUS=$(curl -fsS -o /dev/null -w "%{http_code}" http://localhost:3199/) || true
if [ "${UI_STATUS}" != "200" ]; then
  echo "FAIL: UI index.html 回應 HTTP ${UI_STATUS}，預期 200"
  exit 1
fi
echo "UI 靜態資源回應 HTTP ${UI_STATUS}"

# 驗證 3：Build stamp 與預期 commit 嚴格比對
echo "--- 驗證 build stamp ---"
ACTUAL_COMMIT=$(echo "${HEALTH_RESPONSE}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).commit||'')}catch(e){}})" 2>/dev/null || true)
if [ -z "${ACTUAL_COMMIT}" ]; then
  echo "FAIL: 無法從 /api/health 取得 build stamp commit"
  exit 1
fi
if [ -n "${EXPECTED_COMMIT}" ] && [ "${EXPECTED_COMMIT}" != "${ACTUAL_COMMIT}" ]; then
  echo "FAIL: Build stamp 不一致"
  echo "  預期: ${EXPECTED_COMMIT}"
  echo "  實際: ${ACTUAL_COMMIT}"
  exit 1
fi
echo "Build stamp commit: ${ACTUAL_COMMIT} ✓"

# 驗證 4：容器日誌無 fatal 啟動錯誤
echo "--- 檢查容器啟動日誌 ---"
podman logs "${SMOKE_NAME}" 2>&1 | tail -20
if podman logs "${SMOKE_NAME}" 2>&1 | grep -iq "fatal\|panic\|ECONNREFUSED.*5432"; then
  echo "FAIL: 日誌中發現嚴重錯誤訊息"
  exit 1
fi
echo "日誌檢查通過"

echo ""
echo "=== Smoke test 全部通過 ==="
```

---

## 四、離線交付包（Air-gap Release Bundle）規格與校驗

### 1. 建置端：匯出映像檔並產生完整校驗資料

```bash
IMAGE_TAG="<填入建置時使用的版本標籤>"

# 1. 記錄映像檔不可變 ID 與 Digest
# ⚠️ 注意：本地 build/save/load 流程下，.Digest 可能是空值或 <none>；
#    .Id (如 sha256:...) 是本機 OCI 映像檔最穩定、必備的唯一識別碼。
PAPERCLIP_ID=$(podman image inspect "paperclip:${IMAGE_TAG}" --format '{{.Id}}')
POSTGRES_ID=$(podman image inspect docker.io/library/postgres:17-alpine --format '{{.Id}}')
PAPERCLIP_DIGEST=$(podman image inspect "paperclip:${IMAGE_TAG}" --format '{{.Digest}}' 2>/dev/null || true)
POSTGRES_DIGEST=$(podman image inspect docker.io/library/postgres:17-alpine --format '{{.Digest}}' 2>/dev/null || true)

# 2. 匯出映像檔
podman save "paperclip:${IMAGE_TAG}" | gzip > "paperclip-${IMAGE_TAG}.tar.gz"
podman save docker.io/library/postgres:17-alpine | gzip > postgres-17-alpine.tar.gz

# 3. 計算完整 archive checksum
sha256sum "paperclip-${IMAGE_TAG}.tar.gz" postgres-17-alpine.tar.gz > checksums-archives.sha256

# 4. 若跳板機有單檔上限（例如 500MB），進行分卷切割並產生獨立的分卷 checksum
split -b 500M "paperclip-${IMAGE_TAG}.tar.gz" paperclip-part-
sha256sum paperclip-part-* > checksums-parts.sha256

# 5. 產生 Release Manifest
cat <<EOF > release-manifest.txt
# Paperclip Air-gap Release Manifest
Build Date:        $(date -u +%Y-%m-%dT%H:%M:%SZ)
Source Commit:     ${COMMIT_HASH}
Image Tag:         paperclip:${IMAGE_TAG}
Paperclip Image ID: ${PAPERCLIP_ID}
Paperclip Digest:  ${PAPERCLIP_DIGEST}
Archive Filename:  paperclip-${IMAGE_TAG}.tar.gz
PostgreSQL Image:  docker.io/library/postgres:17-alpine
PostgreSQL Image ID: ${POSTGRES_ID}
PostgreSQL Digest: ${POSTGRES_DIGEST}
Platform:          linux/amd64
EOF

echo "交付包已產生，請一同傳送以下檔案："
ls -lh paperclip-part-* postgres-17-alpine.tar.gz checksums-archives.sha256 checksums-parts.sha256 release-manifest.txt
```

### 2. 交付包內容物清單
交付至 RHEL 8 主機的完整目錄應包含：
- `paperclip-part-*`（分卷檔）
- `postgres-17-alpine.tar.gz`
- `checksums-parts.sha256`（分卷 checksum，用於傳輸後校驗）
- `checksums-archives.sha256`（完整 archive checksum，用於合併後校驗）
- `release-manifest.txt`（Image digest、archive 原始檔名、來源 commit、建置時間、架構）
- 本文件（供操作人員參照）
- Quadlet / systemd unit 設定檔範本（見第五節）

### 3. RHEL 8 離線主機端：匯入與校驗

```bash
# 自動從 release-manifest.txt 解析原始 archive 檔名與 IMAGE_TAG
ARCHIVE_NAME=$(sed -n 's/^Archive Filename:[[:space:]]*//p' release-manifest.txt)
IMAGE_TAG=$(sed -n 's/^Image Tag:[[:space:]]*paperclip://p' release-manifest.txt)

# 1. 校驗分卷檔完整性（使用分卷專用 checksum）
sha256sum -c checksums-parts.sha256

# 2. 合併分卷檔（還原為原始 archive 檔名以匹配 checksums-archives.sha256）
cat paperclip-part-* > "${ARCHIVE_NAME}"

# 3. 校驗合併後的完整 archive checksum
sha256sum -c checksums-archives.sha256

# 4. 匯入 Podman
podman load -i "${ARCHIVE_NAME}"
podman load -i postgres-17-alpine.tar.gz

# 5. 嚴格驗證匯入後的 Image ID 與 Digest（不一致則強制 exit 1）
echo "--- 開始驗證映像檔完整性與識別碼 ---"

EXPECTED_PC_ID=$(grep 'Paperclip Image ID:' release-manifest.txt | awk '{print $NF}')
ACTUAL_PC_ID=$(podman image inspect "paperclip:${IMAGE_TAG}" --format '{{.Id}}')

if [ -z "${ACTUAL_PC_ID}" ] || [ "${ACTUAL_PC_ID}" != "${EXPECTED_PC_ID}" ]; then
  echo "FAIL: Paperclip Image ID 不一致！"
  echo "  預期: ${EXPECTED_PC_ID}"
  echo "  實際: ${ACTUAL_PC_ID}"
  exit 1
fi
echo "Paperclip Image ID 驗證通過: ${ACTUAL_PC_ID} ✓"

EXPECTED_PG_ID=$(grep 'PostgreSQL Image ID:' release-manifest.txt | awk '{print $NF}')
ACTUAL_PG_ID=$(podman image inspect docker.io/library/postgres:17-alpine --format '{{.Id}}')

if [ -z "${ACTUAL_PG_ID}" ] || [ "${ACTUAL_PG_ID}" != "${EXPECTED_PG_ID}" ]; then
  echo "FAIL: PostgreSQL Image ID 不一致！"
  echo "  預期: ${EXPECTED_PG_ID}"
  echo "  實際: ${ACTUAL_PG_ID}"
  exit 1
fi
echo "PostgreSQL Image ID 驗證通過: ${ACTUAL_PG_ID} ✓"

# 若 manifest 中存在非空的 Digest，亦執行比對 (使用 sed 提取，避免空值時 awk 取出欄位名稱)
EXPECTED_PC_DIGEST=$(sed -n 's/^Paperclip Digest:[[:space:]]*//p' release-manifest.txt)
if [ -n "${EXPECTED_PC_DIGEST}" ] && [ "${EXPECTED_PC_DIGEST}" != "<none>" ]; then
  ACTUAL_PC_DIGEST=$(podman image inspect "paperclip:${IMAGE_TAG}" --format '{{.Digest}}' 2>/dev/null || true)
  if [ "${ACTUAL_PC_DIGEST}" != "${EXPECTED_PC_DIGEST}" ]; then
    echo "FAIL: Paperclip Digest 不一致！(預期: ${EXPECTED_PC_DIGEST}, 實際: ${ACTUAL_PC_DIGEST})"
    exit 1
  fi
  echo "Paperclip Digest 驗證通過: ${ACTUAL_PC_DIGEST} ✓"
fi

echo "=== 映像檔完整性校驗全數通過 ==="

# ⚠️ 嚴禁使用 podman tag ... :latest 等 mutable 標籤。
#    Quadlet / systemd unit 中直接引用 paperclip:<IMAGE_TAG>。
```

---

## 五、RHEL 8 離線主機：生產級多實例部署

### 0. 前置檢查：確認 Podman 與容器管理方式

RHEL 8 的 Podman 版本依 minor release 與套件通道而異，**Quadlet 需要 Podman 4.4+（RHEL 8.8+）**。部署前必須先執行版本確認：

```bash
# 檢查 Podman 版本
podman --version

# 檢查 Quadlet generator 是否存在
ls -la /usr/lib/systemd/system-generators/podman-system-generator 2>/dev/null \
  || ls -la /usr/libexec/podman/quadlet 2>/dev/null \
  || echo "WARNING: Quadlet generator 不存在，需使用回退方案"
```

- **若 Quadlet 可用（Podman 4.4+）**：使用本節 A 方案（Quadlet 檔案）。
- **若 Quadlet 不可用**：使用本節 B 方案（rootful systemd `podman run` unit）。

### 1. 多實例規劃
以部署兩套獨立服務為例：
- **實例 A（Team A）**：內部監聽 `127.0.0.1:3101`，資料路徑 `/data/paperclip/instances/team-a`
- **實例 B（Team B）**：內部監聽 `127.0.0.1:3102`，資料路徑 `/data/paperclip/instances/team-b`

### 2. 建立資料目錄（各實例通用）

> ⚠️ **不要手動 `chown` 猜測 UID**。PostgreSQL 容器內部的使用者 UID 不一定為 1000（`postgres:17-alpine` 預設使用 UID 70）；Paperclip 容器內部使用 UID 1000。
> 資料目錄應保留 root 所有權，並依賴 Podman 掛載的 `:Z` SELinux 重標籤進行存取控制。
> 容器首次啟動時，各自 Image 的 ENTRYPOINT 會依據內部 UID 建立所需的子目錄與權限。

```bash
# 建立各實例的資料與 DB 目錄（保留 root 所有權）
sudo mkdir -p /data/paperclip/instances/team-a/{data,pgdata}
sudo mkdir -p /data/paperclip/instances/team-b/{data,pgdata}

# 建立備份目錄與容器配置目錄
sudo mkdir -p /opt/backups
sudo mkdir -p /etc/containers/systemd
```

### 3. 建立環境變數檔案

> ⚠️ **嚴禁使用固定或範例金鑰**。所有機密必須在目標主機現場使用 `openssl rand -hex 32` 產生，禁止提交至版本控制。
> 環境變數檔案必須設定為 `root:root` 且權限 `0600`，降低 `podman inspect` 或 host 權限使用者讀取的風險。
> 若企業資安規範更嚴格，應改用 systemd credentials 或 `podman secret`。

```bash
# ===== 實例 A =====
AUTH_SEC_A=$(openssl rand -hex 32)
SIGN_SEC_A=$(openssl rand -hex 32)
DB_PASS_A=$(openssl rand -hex 24)
IMAGE_TAG="<填入 release-manifest.txt 中的 Image Tag>"

sudo tee /etc/containers/systemd/paperclip-team-a.env > /dev/null <<EOF
POSTGRES_USER=paperclip
POSTGRES_PASSWORD=${DB_PASS_A}
POSTGRES_DB=paperclip_team_a
DATABASE_URL=postgres://paperclip:${DB_PASS_A}@localhost:5432/paperclip_team_a
BETTER_AUTH_SECRET=${AUTH_SEC_A}
PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=${SIGN_SEC_A}
PAPERCLIP_PUBLIC_URL=https://teama.paperclip.internal
PAPERCLIP_ALLOWED_HOSTNAMES=teama.paperclip.internal
EOF

# 設定安全權限（root:root 0600）
sudo chown root:root /etc/containers/systemd/paperclip-team-a.env
sudo chmod 0600 /etc/containers/systemd/paperclip-team-a.env
```

### 方案 A：Quadlet 部署（Podman 4.4+ / RHEL 8.8+）

#### Pod 定義 `/etc/containers/systemd/paperclip-team-a.pod`
```ini
[Pod]
PodName=paperclip-team-a
# 僅監聽 Loopback 127.0.0.1，外部流量嚴格由 Nginx HTTPS 轉發
PublishPort=127.0.0.1:3101:3100
```

#### DB 容器 `/etc/containers/systemd/paperclip-team-a-db.container`
```ini
[Unit]
Description=PostgreSQL for Paperclip Team A

[Container]
Image=docker.io/library/postgres:17-alpine
ContainerName=paperclip-team-a-db
Pod=paperclip-team-a.pod
# 資料目錄保留 root 所有權，:Z 由 Podman 處理 SELinux 重標籤，
# postgres image entrypoint 會以容器內部 postgres UID 初始化資料目錄
Volume=/data/paperclip/instances/team-a/pgdata:/var/lib/postgresql/data:Z
EnvironmentFile=/etc/containers/systemd/paperclip-team-a.env
HealthCmd=pg_isready -U $POSTGRES_USER -d $POSTGRES_DB -h localhost || exit 1
HealthInterval=15s
HealthTimeout=5s
HealthRetries=5

[Service]
Restart=on-failure
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target default.target
```

#### Server 容器 `/etc/containers/systemd/paperclip-team-a.container`

> ⚠️ **`Image=` 必須使用不可變版本標籤**（如 `paperclip:2026.1104-a1b2c3d4e5f6`），
> 嚴禁使用 `:latest` 等 mutable tag——否則更新、稽核與回滾均無法可靠對應到具體版本。

```ini
[Unit]
Description=Paperclip AI Orchestrator Team A
Requires=paperclip-team-a-db.service
After=paperclip-team-a-db.service

[Container]
# ⚠️ 必須使用不可變版本標籤，例如：
# Image=localhost/paperclip:2026.1104-a1b2c3d4e5f6
Image=localhost/paperclip:<IMAGE_TAG>
ContainerName=paperclip-team-a
Pod=paperclip-team-a.pod
Volume=/data/paperclip/instances/team-a/data:/paperclip:Z
Volume=/data/paperclip/shared/plugins:/app/packages/plugins/custom:ro,z
Environment=HOST=0.0.0.0
Environment=PAPERCLIP_HOME=/paperclip
Environment=PAPERCLIP_INSTANCE_ID=team-a
Environment=PAPERCLIP_CONFIG=/paperclip/instances/team-a/config.json
Environment=PAPERCLIP_DEPLOYMENT_MODE=authenticated
Environment=PAPERCLIP_DEPLOYMENT_EXPOSURE=private
EnvironmentFile=/etc/containers/systemd/paperclip-team-a.env

[Service]
Restart=on-failure
# Paperclip 啟動包含 DB migration 與 runner 初始化，需要較長的啟動逾時
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target default.target
```

### 方案 B：回退方案——rootful systemd `podman run` unit（所有 RHEL 8 均支援）

若 RHEL 8 的 Podman 版本不支援 Quadlet，可使用 rootful systemd unit 進行託管。

依據主機對容器 DNS 的支援程度，提供兩種子方案：
- **方案 B-1（自訂網路模式）**：需主機支援容器間 DNS 解析（RHEL 8 需有 `aardvark-dns` 或 CNI `dnsname` 套件）。
- **方案 B-2（原生 Pod 模式，強烈推薦）**：直接建立 Podman Pod 共享 loopback，**100% 不依賴任何 DNS 插件**，在所有 RHEL 8 版本上最穩定。

---

#### 方案 B-1：自訂網路模式（User-defined Network）

> ⚠️ **前置 DNS 驗證（必做）**：
> 舊版 RHEL 8 若缺少 DNS 插件，自訂網路下的容器將無法解析彼此名稱。部屬前必須實機驗證：

```bash
# 1. 建立實例網路
sudo podman network create paperclip-team-a-net

# 2. 檢查網路是否具備 DNS 能力
sudo podman network inspect paperclip-team-a-net | grep -E "dns_enabled|plugins"

# 3. 部署 DB 後，使用暫時容器驗證 DNS 與 TCP 連線（啟動 DB 服務後執行）：
sudo podman run --rm --network paperclip-team-a-net docker.io/library/postgres:17-alpine \
  pg_isready -h paperclip-team-a-db -p 5432 \
  || { echo "FAIL: 容器名稱無法解析或 5432 埠口不通；請改用方案 B-2 (Pod 模式)"; exit 1; }
```

##### 修改環境變數檔案中的 DATABASE_URL
在方案 B-1 下，`DATABASE_URL` 指向 DB 容器名稱：
```bash
# 修改 /etc/containers/systemd/paperclip-team-a.env 中的 DATABASE_URL：
# DATABASE_URL=postgres://paperclip:<PASSWORD>@paperclip-team-a-db:5432/paperclip_team_a
```

##### DB 服務 `/etc/systemd/system/paperclip-team-a-db.service`
```ini
[Unit]
Description=PostgreSQL for Paperclip Team A
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
NotifyAccess=all
Restart=on-failure
TimeoutStartSec=90
TimeoutStopSec=30

ExecStartPre=-/usr/bin/podman rm -f paperclip-team-a-db
ExecStart=/usr/bin/podman run \
  --name paperclip-team-a-db \
  --network paperclip-team-a-net \
  --network-alias paperclip-team-a-db \
  --sdnotify=conmon \
  --cidfile=/run/paperclip-team-a-db.cid \
  --health-cmd "pg_isready -U paperclip -d paperclip_team_a -h localhost || exit 1" \
  --health-interval 15s \
  --health-timeout 5s \
  --health-retries 5 \
  -v /data/paperclip/instances/team-a/pgdata:/var/lib/postgresql/data:Z \
  --env-file /etc/containers/systemd/paperclip-team-a.env \
  docker.io/library/postgres:17-alpine
ExecStop=/usr/bin/podman stop paperclip-team-a-db
ExecStopPost=-/usr/bin/podman rm -f paperclip-team-a-db
ExecStopPost=-/bin/rm -f /run/paperclip-team-a-db.cid

[Install]
WantedBy=multi-user.target
```

##### Server 服務 `/etc/systemd/system/paperclip-team-a.service`
```ini
[Unit]
Description=Paperclip AI Orchestrator Team A
Requires=paperclip-team-a-db.service
After=paperclip-team-a-db.service

[Service]
Type=notify
NotifyAccess=all
Restart=on-failure
TimeoutStartSec=120
TimeoutStopSec=90

ExecStartPre=-/usr/bin/podman rm -f paperclip-team-a
# ⚠️ 以下 <IMAGE_TAG> 必須替換為不可變版本標籤
ExecStart=/usr/bin/podman run \
  --name paperclip-team-a \
  --network paperclip-team-a-net \
  --sdnotify=conmon \
  --cidfile=/run/paperclip-team-a.cid \
  -p 127.0.0.1:3101:3100 \
  -v /data/paperclip/instances/team-a/data:/paperclip:Z \
  -v /data/paperclip/shared/plugins:/app/packages/plugins/custom:ro,z \
  -e HOST=0.0.0.0 \
  -e PAPERCLIP_HOME=/paperclip \
  -e PAPERCLIP_INSTANCE_ID=team-a \
  -e PAPERCLIP_CONFIG=/paperclip/instances/team-a/config.json \
  -e PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  -e PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  --env-file /etc/containers/systemd/paperclip-team-a.env \
  localhost/paperclip:<IMAGE_TAG>
ExecStop=/usr/bin/podman stop paperclip-team-a
ExecStopPost=-/usr/bin/podman rm -f paperclip-team-a
ExecStopPost=-/bin/rm -f /run/paperclip-team-a.cid

[Install]
WantedBy=multi-user.target
```

---

#### 方案 B-2：原生 Pod 模式（Podman Pod，無 DNS 插件依賴，最推薦）

若主機缺少 DNS 插件，直接利用 Podman 最基礎的原生 Pod 功能。容器共享 Network Namespace，完全避開 DNS 解析問題。

為了確保 Pod 在主機重啟、容器異常重啟或災難復原時皆能可靠存在，**Pod 本身由獨立的 systemd unit 進行宣告與生命週期管理**，DB 與 Server 服務透過 `BindsTo=` / `After=` 綁定該 Pod。

##### 1. Pod 服務單元 `/etc/systemd/system/paperclip-team-a-pod.service`
```ini
[Unit]
Description=Podman Pod for Paperclip Team A
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
# 冪等啟動：若 Pod 已存在則嘗試啟動 (已 running 則忽略錯誤)，若不存在則建立
ExecStart=/usr/bin/sh -c 'if /usr/bin/podman pod exists paperclip-team-a-pod; then /usr/bin/podman pod start paperclip-team-a-pod 2>/dev/null || true; else /usr/bin/podman pod create --name paperclip-team-a-pod -p 127.0.0.1:3101:3100; fi'
ExecStop=/usr/bin/podman pod stop -t 10 paperclip-team-a-pod

[Install]
WantedBy=multi-user.target
```

##### 2. DB 服務 `/etc/systemd/system/paperclip-team-a-db.service`
```ini
[Unit]
Description=PostgreSQL for Paperclip Team A (Pod Mode)
Requires=paperclip-team-a-pod.service
BindsTo=paperclip-team-a-pod.service
After=network-online.target paperclip-team-a-pod.service

[Service]
Type=notify
NotifyAccess=all
Restart=on-failure
TimeoutStartSec=90
TimeoutStopSec=30

# 雙重防禦：確保 Pod 必處於 Running 狀態再啟動容器
ExecStartPre=-/usr/bin/sh -c 'if /usr/bin/podman pod exists paperclip-team-a-pod; then /usr/bin/podman pod start paperclip-team-a-pod 2>/dev/null || true; else /usr/bin/podman pod create --name paperclip-team-a-pod -p 127.0.0.1:3101:3100; fi'
ExecStartPre=-/usr/bin/podman rm -f paperclip-team-a-db
ExecStart=/usr/bin/podman run \
  --name paperclip-team-a-db \
  --pod paperclip-team-a-pod \
  --sdnotify=conmon \
  --cidfile=/run/paperclip-team-a-db.cid \
  --health-cmd "pg_isready -U paperclip -d paperclip_team_a -h localhost || exit 1" \
  --health-interval 15s \
  --health-timeout 5s \
  --health-retries 5 \
  -v /data/paperclip/instances/team-a/pgdata:/var/lib/postgresql/data:Z \
  --env-file /etc/containers/systemd/paperclip-team-a.env \
  docker.io/library/postgres:17-alpine
ExecStop=/usr/bin/podman stop paperclip-team-a-db
ExecStopPost=-/usr/bin/podman rm -f paperclip-team-a-db
ExecStopPost=-/bin/rm -f /run/paperclip-team-a-db.cid

[Install]
WantedBy=multi-user.target
```

##### 3. Server 服務 `/etc/systemd/system/paperclip-team-a.service`
```ini
[Unit]
Description=Paperclip AI Orchestrator Team A (Pod Mode)
Requires=paperclip-team-a-pod.service paperclip-team-a-db.service
BindsTo=paperclip-team-a-pod.service
After=paperclip-team-a-pod.service paperclip-team-a-db.service

[Service]
Type=notify
NotifyAccess=all
Restart=on-failure
TimeoutStartSec=120
TimeoutStopSec=90

# 雙重防禦：確保 Pod 必處於 Running 狀態再啟動容器
ExecStartPre=-/usr/bin/sh -c 'if /usr/bin/podman pod exists paperclip-team-a-pod; then /usr/bin/podman pod start paperclip-team-a-pod 2>/dev/null || true; else /usr/bin/podman pod create --name paperclip-team-a-pod -p 127.0.0.1:3101:3100; fi'
ExecStartPre=-/usr/bin/podman rm -f paperclip-team-a
ExecStart=/usr/bin/podman run \
  --name paperclip-team-a \
  --pod paperclip-team-a-pod \
  --sdnotify=conmon \
  --cidfile=/run/paperclip-team-a.cid \
  -v /data/paperclip/instances/team-a/data:/paperclip:Z \
  -v /data/paperclip/shared/plugins:/app/packages/plugins/custom:ro,z \
  -e HOST=0.0.0.0 \
  -e PAPERCLIP_HOME=/paperclip \
  -e PAPERCLIP_INSTANCE_ID=team-a \
  -e PAPERCLIP_CONFIG=/paperclip/instances/team-a/config.json \
  -e PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  -e PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  --env-file /etc/containers/systemd/paperclip-team-a.env \
  localhost/paperclip:<IMAGE_TAG>
ExecStop=/usr/bin/podman stop paperclip-team-a
ExecStopPost=-/usr/bin/podman rm -f paperclip-team-a
ExecStopPost=-/bin/rm -f /run/paperclip-team-a.cid

[Install]
WantedBy=multi-user.target
```

### 啟動、驗證與故障排除（各方案通用）

```bash
# 載入新的 unit 檔案
sudo systemctl daemon-reload

# 啟動服務（若使用 B-2 方案，systemd 會依據 Requires 與 BindsTo 自動帶起 Pod 服務，再依序啟動 DB 與 Server）
sudo systemctl start paperclip-team-a.service

# 檢查狀態
sudo systemctl status paperclip-team-a-db.service
sudo systemctl status paperclip-team-a.service

# 設定開機自啟動
# 若為方案 B-2 (Pod 模式)：
# sudo systemctl enable paperclip-team-a-pod.service
sudo systemctl enable paperclip-team-a-db.service
sudo systemctl enable paperclip-team-a.service

# 檢查 Podman 容器狀態
podman ps
```

> ⚠️ **首次啟動行為說明**：
>
> `Requires=` / `After=` 僅保證 DB service 被啟動（即 podman run 指令已被執行），
> **不等於** PostgreSQL 已經完成初始化並可接受連線。
> Paperclip 容器首次啟動時可能因 DB 尚未 ready 而啟動失敗。
> 此時 `Restart=on-failure` 會自動重試，通常 1~2 次重試後即可正常啟動。
>
> **請務必在首次啟動後觀察日誌，確認服務最終穩定運行：**

```bash
# 追蹤 Server 服務即時日誌
sudo journalctl -u paperclip-team-a.service -f

# 追蹤 DB 服務即時日誌
sudo journalctl -u paperclip-team-a-db.service -f

# 驗證 health endpoint
curl -fsS http://127.0.0.1:3101/api/health
```

---

## 六、前端 Nginx 反向代理與 HTTPS 安全架構（生產規範）

生產環境所有外部存取均需終止於 Nginx，由 Nginx 提供 TLS 加密與內部網域路由。
Paperclip 容器嚴格綁定 `127.0.0.1`，不直接對外。

### 1. Nginx 站點設定 `/etc/nginx/conf.d/paperclip.conf`
```nginx
# 在 /etc/nginx/nginx.conf 的 http 區塊中加入 (若尚未存在)：
# map $http_upgrade $connection_upgrade {
#     default upgrade;
#     ''      close;
# }

# 實例 A：Team A
server {
    listen 443 ssl http2;
    server_name teama.paperclip.internal;

    ssl_certificate /etc/pki/tls/certs/corp_wildcard.crt;
    ssl_certificate_key /etc/pki/tls/private/corp_wildcard.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;

        # WebSocket 與 SSE (Server-Sent Events) 串流標頭
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        # 關鍵：關閉 Proxy 緩衝以確保 Agent SSE 串流即時傳輸
        proxy_buffering off;
        proxy_cache off;

        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}

# HTTP 80 強制導向 HTTPS
server {
    listen 80;
    server_name teama.paperclip.internal;
    return 301 https://$host$request_uri;
}
```

### 2. SELinux 與防火牆設置
```bash
# 允許 Nginx 反向代理連線至本機連接埠
sudo setsebool -P httpd_can_network_connect 1

# 開放 HTTPS 防火牆
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload

# 驗證與重載 Nginx
sudo nginx -t && sudo systemctl reload nginx
```

---

## 七、備份、還原與版本回滾 SOP

### 1. 定期資料庫備份

建議以 crontab 或 systemd timer 定期執行：

```bash
#!/bin/bash
# /data/paperclip/scripts/backup-instance.sh <instance-name> [db-name]
# 使用範例：
#   backup-instance.sh team-a paperclip_team_a
#   backup-instance.sh team-b paperclip_team_b
INSTANCE="${1:?Usage: backup-instance.sh <instance-name> [db-name]}"
# DB 名稱必須明確傳入，因為 instance name 含連字號 (team-a) 而 DB 名稱使用底線 (paperclip_team_a)
DB_NAME="${2:?Usage: backup-instance.sh <instance-name> <db-name>  (例如: team-a paperclip_team_a)}"
BACKUP_DIR="/opt/backups"
BACKUP_DATE=$(date +%Y%m%d_%H%M%S)

# DB 備份
podman exec "paperclip-${INSTANCE}-db" \
  pg_dump -U paperclip "${DB_NAME}" \
  | gzip > "${BACKUP_DIR}/${DB_NAME}_db_${BACKUP_DATE}.sql.gz"

# Instance data 備份
tar -czf "${BACKUP_DIR}/${DB_NAME}_data_${BACKUP_DATE}.tar.gz" \
  -C /data/paperclip/instances/"${INSTANCE}" data/

echo "備份完成："
ls -lh "${BACKUP_DIR}/${DB_NAME}_"*"_${BACKUP_DATE}"*
```

### 2. 版本更新流程

```bash
INSTANCE="team-a"
DB_NAME="paperclip_team_a"
NEW_TAG="<新版 IMAGE_TAG>"

# 1. 更新前先執行備份（同時備份 DB 與 data）
bash /data/paperclip/scripts/backup-instance.sh "${INSTANCE}" "${DB_NAME}"

# 2. 匯入新版映像檔
podman load -i "paperclip-${NEW_TAG}.tar.gz"

# 3. 驗證 Image digest 與 release-manifest.txt 相符
podman image inspect "paperclip:${NEW_TAG}" --format '{{.Digest}}'

# 4. 修改映像檔版本標籤
# 方案 A (Quadlet)：
sudo sed -i "s|Image=localhost/paperclip:.*|Image=localhost/paperclip:${NEW_TAG}|" \
  /etc/containers/systemd/paperclip-${INSTANCE}.container 2>/dev/null || true
# 方案 B (回退 systemd unit)：
sudo sed -i "s|localhost/paperclip:.*|localhost/paperclip:${NEW_TAG}|" \
  /etc/systemd/system/paperclip-${INSTANCE}.service 2>/dev/null || true

# 5. 重載並重啟
sudo systemctl daemon-reload
sudo systemctl restart "paperclip-${INSTANCE}.service"

# 6. 觀察啟動日誌確認正常
sudo journalctl -u "paperclip-${INSTANCE}.service" -f
```

### 3. 版本回滾流程

> ⚠️ **重要警告**：若新版已執行 database migration（schema 變更），
> 單純將 Image Tag 改回舊版**可能導致舊版程式無法辨識新 schema 而啟動失敗**。
> 回滾時必須同時還原對應時間點的資料庫備份與 instance data。

```bash
INSTANCE="team-a"
DB_NAME="paperclip_team_a"
OLD_TAG="<上一版 IMAGE_TAG>"

# 1. 停止服務
sudo systemctl stop "paperclip-${INSTANCE}.service"
sudo systemctl stop "paperclip-${INSTANCE}-db.service"

# 2. 確認舊版映像檔仍存在
podman image exists "paperclip:${OLD_TAG}" || { echo "舊版映像檔不存在，無法回滾"; exit 1; }

# 3. 若新版已執行 schema migration，必須還原 DB 與 data
#    （若確認新版未跑 migration，可跳過此步驟直接到步驟 4）
BACKUP_FILE="/opt/backups/${DB_NAME}_db_<BACKUP_TIMESTAMP>.sql.gz"

# 清空並還原 DB
sudo systemctl start "paperclip-${INSTANCE}-db.service"
sleep 10  # 等待 DB 啟動
# 指定維護資料庫為 template1 並強制中斷現有連線，確保能乾淨刪除與重建
podman exec "paperclip-${INSTANCE}-db" dropdb -U paperclip --maintenance-db=template1 --force "${DB_NAME}" --if-exists
podman exec "paperclip-${INSTANCE}-db" createdb -U paperclip --maintenance-db=template1 "${DB_NAME}"
gunzip -c "${BACKUP_FILE}" | podman exec -i "paperclip-${INSTANCE}-db" psql -U paperclip -d "${DB_NAME}"

# 清理新版產生的不相容殘留檔案，並還原 instance data
sudo rm -rf "/data/paperclip/instances/${INSTANCE}/data"
tar -xzf "/opt/backups/${DB_NAME}_data_<BACKUP_TIMESTAMP>.tar.gz" \
  -C /data/paperclip/instances/"${INSTANCE}"/

# 4. 修改 Image Tag 回舊版
# 方案 A (Quadlet)：
sudo sed -i "s|Image=localhost/paperclip:.*|Image=localhost/paperclip:${OLD_TAG}|" \
  /etc/containers/systemd/paperclip-${INSTANCE}.container 2>/dev/null || true
# 方案 B (回退 systemd unit)：
sudo sed -i "s|localhost/paperclip:.*|localhost/paperclip:${OLD_TAG}|" \
  /etc/systemd/system/paperclip-${INSTANCE}.service 2>/dev/null || true

# 5. 重載並啟動
sudo systemctl daemon-reload
sudo systemctl restart "paperclip-${INSTANCE}-db.service"
sudo systemctl restart "paperclip-${INSTANCE}.service"

# 6. 驗證
sudo journalctl -u "paperclip-${INSTANCE}.service" -f
curl -fsS http://127.0.0.1:3101/api/health
```

---

## 八、附錄：暫時性 POC 直連模式說明（非生產）

> ⚠️ **資安警語**：直連 HTTP 模式會導致身分驗證 Session 與機密以明文傳輸，且直接暴露容器埠口至企業內網，**僅限於無憑證環境下的功能性概念驗證（POC），嚴禁用於正式生產環境**。

若僅在內部封閉實驗室進行功能驗證：
1. 將 Pod 定義中的 `PublishPort` 改為全域綁定：
   ```ini
   # Quadlet .pod 檔案
   PublishPort=3101:3100
   ```
   或在回退方案的 systemd unit 中，將 `-p 127.0.0.1:3101:3100` 改為 `-p 3101:3100`。
2. 防火牆放行該 Port：
   ```bash
   sudo firewall-cmd --permanent --add-port=3101/tcp
   sudo firewall-cmd --reload
   ```
3. 環境變數改為：
   ```ini
   PAPERCLIP_PUBLIC_URL=http://<RHEL_主機_IP>:3101
   PAPERCLIP_ALLOWED_HOSTNAMES=<RHEL_主機_IP>
   ```

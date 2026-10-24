# Azure VM 上 Codex `native_session_interrupted` 排查與修正

## 適用情境

Paperclip 使用 Docker 部署在 Ubuntu 24.04 Azure VM，透過內建 Paperclip Runner 啟動 Codex local provider；任務啟動時失敗並顯示：

```text
native_session_interrupted
failed to start Codex provider
```

本文件記錄一次實際故障的診斷結果與修正方式。

## 最終根因

Codex provider 使用 `bubblewrap`（`bwrap`）建立檔案、使用者與網路 namespace。Paperclip server 本身正常，但 Docker container 與 Ubuntu 24.04 主機的 sandbox 限制，依序阻擋了不同階段：

1. Docker 預設 AppArmor/seccomp 阻擋 user namespace。
2. 放寬後，container 缺少 `CAP_NET_ADMIN`，無法建立 loopback 網路介面。
3. 再補上 `CAP_NET_ADMIN` 後，巢狀 namespace 仍需要 `CAP_SYS_ADMIN`。
4. Ubuntu 24.04 主機的 `kernel.apparmor_restrict_unprivileged_userns=1` 仍限制非 root user namespace。

最後的主機錯誤為：

```text
bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted
```

## 已採用的修正

### 1. Paperclip server container 設定

在 `docker-compose.override.yml` 的 `server` service 加入：

```yaml
services:
  server:
    ports: !reset []
    cap_add:
      - NET_ADMIN
      - SYS_ADMIN
    security_opt:
      - apparmor=unconfined
      - seccomp=unconfined
```

這只放寬 Paperclip server container，不使用整個 `privileged: true`。

套用設定：

```bash
docker compose \
  --env-file .env \
  -f docker/docker-compose.yml \
  -f docker-compose.override.yml \
  config >/dev/null

docker compose \
  --env-file .env \
  -f docker/docker-compose.yml \
  -f docker-compose.override.yml \
  up -d server
```

### 2. Ubuntu 主機設定

因為這台 VM 是 Paperclip 專用機，已允許非 root user namespace：

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

為了讓重開機後仍有效，建立：

```bash
printf '%s\n' \
  'kernel.apparmor_restrict_unprivileged_userns=0' \
  | sudo tee /etc/sysctl.d/99-paperclip-codex.conf >/dev/null

sudo sysctl --system
```

確認：

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
```

預期：

```text
kernel.apparmor_restrict_unprivileged_userns = 0
```

## 驗證方式

### Server 與 HTTPS

```bash
docker compose \
  --env-file .env \
  -f docker/docker-compose.yml \
  -f docker-compose.override.yml \
  ps

curl -fsS https://<paperclip-domain>/api/health
```

`/api/health` 應回傳 `status: ok`。

### Container 權限

```bash
docker inspect docker-server-1 \
  --format 'status={{.State.Status}} capadd={{json .HostConfig.CapAdd}} securityopt={{json .HostConfig.SecurityOpt}}'
```

應包含：

```text
CAP_NET_ADMIN
CAP_SYS_ADMIN
apparmor=unconfined
seccomp=unconfined
```

### Runner 錯誤查詢

```bash
docker logs --since 15m docker-server-1 2>&1 \
  | jq -Rr 'try fromjson catch empty
    | select((.level|type)=="number" and .level >= 40)
    | [.time,.level,.msg,(.err.message // ""),(.error.message // "")]
    | @tsv'
```

確認沒有新的：

```text
native_session_interrupted
bwrap: ... Operation not permitted
```

## 其他部署前置條件

這個專案的 Docker image 建置也需要較多資源：

- RAM：建議至少 8 GB；TypeScript build 在 4 GB VM 上曾被 OOM killer 終止。
- Swap：可配置 4 GB 作為緩衝，但不能取代足夠 RAM。
- OS disk：建議至少 64 GB；Docker build layers 與 cache 在 29 GB disk 上曾出現 `no space left on device`。
- 建置完成後使用 `tmux` 執行 Compose，避免 SSH 中斷建置。

## 安全注意事項

這些設定會降低隔離程度：

- `apparmor=unconfined` 與 `seccomp=unconfined` 會放寬 server container 的預設防護。
- `NET_ADMIN` 與 `SYS_ADMIN` 讓 container 內的 nested sandbox 能建立 namespace 與網路介面。
- `kernel.apparmor_restrict_unprivileged_userns=0` 會讓整台 VM 的非 root 程序可建立 user namespace。

因此只適合專用、受控的 VM。若需要執行不受信任的 agent code，應改用獨立 sandbox VM、Kubernetes sandbox provider 或外部 runner，而不是在 control-plane container 內放寬這些限制。

## 回復設定

若不再使用 Codex local provider：

1. 從 `docker-compose.override.yml` 移除 `cap_add` 與 `security_opt`。
2. 恢復主機限制：

   ```bash
   sudo rm -f /etc/sysctl.d/99-paperclip-codex.conf
   sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1
   ```

3. 重建 server container：

   ```bash
   docker compose \
     --env-file .env \
     -f docker/docker-compose.yml \
     -f docker-compose.override.yml \
     up -d server
   ```

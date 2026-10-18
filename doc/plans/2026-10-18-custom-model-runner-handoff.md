# Custom Model Runner 開發交接說明

## 目標

將自訂模型／Gateway 從 Codex runner 拆出，建立專用的 `custom` runner。自訂模型不應要求本機安裝 `codex`、Codex 登入或 Codex subscription。

目前 UI 將以下兩件事錯誤綁定：

- OpenAI Responses API → Codex
- Chat Completions API → OpenCode

API 格式只代表 Endpoint 協定，不應決定 Agent runner。

## 使用者問題

目前使用 Azure OpenAI-compatible Endpoint：

```text
https://twsoft-claw.openai.azure.com/openai/v1
```

模型：

```text
gpt-5.6-luna
```

API key 直接呼叫 `/responses` 已驗證可用，但 Agent Test 仍會出現：

- `The selected Codex account needs authentication.`
- `Command not found in PATH: "codex"`
- `The Codex run failed before it completed.`

這些訊息是 runner 選擇錯誤造成，不是 Azure API key 或模型本身的必要條件。

## 已完成、不要重做

### 連線去重

`server/src/services/ai-connections.ts` 已加入建立時去重：

- 比對 company、provider、method、routing kind/protocol/base URL/auth、擁有者。
- API key 以實際 secret value 比對。
- 不同 API key 不合併。
- 重複建立會重用既有 connection/grant。

### 連線清理

本機 `twsoft` company 已清理重複資料：

- 個人 API key 重複項目已 revoke。
- 公司 shared API key 中相同 key 的重複項目已 revoke。
- 不同 key、不同 auth、不同 owner 的連線保留。
- revoke 資料保留稽核紀錄，不是硬刪除。

### 名稱

自訂 Gateway 的泛用名稱已改為包含 Endpoint 與認證方式，例如：

- `OpenAI · twsoft-claw.openai.azure.com · API key`
- `OpenAI · twsoft-claw.openai.azure.com · Bearer`
- `Company · twsoft-claw.openai.azure.com · API key`
- `Company · twsoft-claw.openai.azure.com · Bearer`

### Revoked UI

以下元件已過濾 `revoked` connection，避免在選單顯示灰色的 `Reconnect`：

- `ui/src/components/ai-connections/AiConnectionSelect.tsx`
- `ui/src/components/ai-connections/AiConnectionPicker.tsx`

### 暫時性測試調整

目前曾加入暫時性相容處理：自訂 Gateway API key 驗證成功時，將缺少 Codex CLI 降為 warning。這只是過渡措施，Custom runner 完成後應移除，不應繼續保留 Codex fallback 邏輯。

相關檔案：

- `server/src/services/agent-environment-test.ts`
- `ui/src/components/new-agent/NewAgentSetup.tsx`

### Draft refresh bug

`ui/src/components/new-agent/NewAgentSetup.tsx` 已將 `customEndpointDraft` 視為一次性 history state，避免 refresh 後重開 Connect account 並帶回舊模型。

## 主要開發工作

### 1. 建立 Custom runner identity

不要把 custom endpoint 映射成 `codex_local` 或 `opencode_local`。新增明確的 custom runner／adapter identity，例如：

```text
custom_local
```

或使用現有 Paperclip runner 內的 provider identity，但必須讓它在所有 capability、test、runtime resolution 中與 Codex 分離。

需要檢查：

- `packages/shared/src/ai-connections.ts`
- `packages/shared/src/ai-provider-routing.ts`
- `server/src/services/ai-connection-runtime.ts`
- `server/src/services/agent-environment-test.ts`
- `ui/src/components/new-agent/AgentBasicsDialog.tsx`
- `ui/src/components/new-agent/NewAgentSetup.tsx`
- `ui/src/components/ai-connections/AiProviderSetup.tsx`
- adapter registry / adapter capability definitions

### 2. Custom runner 的執行契約

Custom runner 至少需要：

- base URL
- auth mode：`api_key`、`bearer`、`none`
- secret reference，不可把 key 明文放入 agent config
- protocol：`responses` 或 `chat`
- model/deployment ID
- model discovery / endpoint verification
- 清楚的 capability 結果

Custom runner 不應：

- 讀取 Codex auth file
- 要求 `codex` 在 PATH
- 執行 Codex login / hello probe
- 將缺少 Codex 當成 custom API key invalid

### 3. Test 行為

自訂 Gateway Test 應：

1. 驗證 Endpoint 可連線。
2. 以正確 auth header 驗證：
   - `api_key` → `api-key: <secret>`
   - `bearer` → `Authorization: Bearer <secret>`
   - `none` → 不帶 credential
3. 驗證 model/deployment 是否可用。
4. 回報 endpoint/model 的實際錯誤。
5. 不執行 Codex binary probe。

錯誤應清楚區分：

- API key invalid
- endpoint unreachable
- model/deployment not found
- protocol unsupported
- custom runner unavailable

### 4. UI

Custom endpoint 的 UI 應顯示：

```text
Runner: Custom
Protocol: OpenAI Responses / Chat Completions
```

不能顯示或暗示：

```text
Codex account
Codex login required
```

如果 Custom runner 尚未支援某項能力，應顯示具體 warning，而不是把連線選項禁用或顯示 Codex auth error。

### 5. Runtime

Agent run 使用 Custom runner 時，應直接使用 custom routing 設定。可重用現有：

- `server/src/services/ai-provider-routing.ts`
- `managedProviderRouting`
- `packages/paperclip-runner` 的 provider proxy／HTTP transport

但不得讓 runtime identity、session identity、capability checks 退回 `codex_local`。

## 測試要求

新增或補足以下測試：

### Server

- custom API key test 不需要 `codex` binary。
- custom bearer test 不需要 Codex login。
- custom Responses endpoint 可完成 test。
- custom Chat Completions endpoint 可完成 test。
- invalid key 顯示 API key error，而不是 Codex auth error。
- missing model/deployment 顯示 model error。
- agent runtime 使用 custom runner，不讀取 Codex auth。

### UI

- Custom connection 顯示 Custom runner。
- Custom test 成功後不要求 Codex hello probe。
- `codex` 缺少不會讓 custom API key test 變成失敗。
- revoked connections 不出現在選擇清單。
- refresh 不會重開一次性 custom endpoint draft。

### 驗證指令

```sh
pnpm exec tsc --noEmit -p server/tsconfig.json
pnpm exec tsc --noEmit -p ui/tsconfig.json
pnpm exec vitest run server/src/__tests__/agent-test-environment-routes.test.ts
pnpm exec vitest run ui/src/components/NewAgentDialog.test.tsx
pnpm exec vitest run ui/src/components/ai-connections/AiConnectionField.test.tsx
```

若修改 adapter 或 runner，再補跑對應 package tests。

## 重要注意事項

1. 不要用 connection name 判斷是否重複；要比對 endpoint、auth、owner 與實際 credential。
2. 不要刪除不同 API key 的連線。
3. 不要將 revoked connection 重新設為 active，除非重新驗證 credential 成功。
4. 不要用「把 Codex 錯誤改成 warning」當成最終解法；最終目標是 Custom runner 不經過 Codex path。
5. 不要覆蓋其他未相關的使用者修改。工作區目前另有既有修改，先用 `git status` / `git diff` 確認。

## 完成條件

- 使用者選擇自訂 Endpoint 後，測試不再要求 Codex。
- 不安裝 Codex 也能完成 custom endpoint test。
- Agent run 不再出現 `Command not found in PATH: "codex"`。
- Custom runner 能以保存的 API key/bearer/none credential 呼叫指定模型。
- 一般 OpenAI Codex subscription flow 不被破壞。
- 相關 server、UI、runner tests 通過。

## 最新進度與未完成問題（交接追加）

### 已完成的第一階段調整

- `custom_local` adapter identity 已存在。
- Custom endpoint discovery/test 已使用 HTTP 驗證，不再執行 Codex login 或 Codex binary probe。
- Custom connection UI 已與 Agent adapter 選擇拆開：Adapter 頁只選 Custom runner，Endpoint 設定由共用 Provider connection flow 處理。
- Provider connection 可保存多個 model/deployment；同一 Endpoint/credential 不因 model 不同而建立多筆 connection。
- terminated Agent 不再阻擋相同名稱的新 Agent。
- Custom model 會正規化為 `paperclip/<model>` 以符合現有 provider/model 格式。
- `/models` 沒有 OPTIONS protocol 回應時，Custom test 會嘗試實際 POST protocol probe。

### 目前仍會失敗的症狀

Custom Agent 執行時仍可能出現：

```text
Unsupported parameter: 'max_tokens' is not supported with this model.
Use 'max_completion_tokens' instead.
(adapter_failed)
```

stderr 仍會看到 OpenCode skill injection，例如：

```text
[paperclip] Injected OpenCode skill ...
```

這證明 `custom_local` 雖然有獨立 identity，執行時仍繼承／呼叫了 `opencode_local` transport。這不是 API key、model discovery 或連線去重問題。

### 不要採用的假修正

以下只能作為暫時診斷，不能當最終解法：

- 只把 `max_tokens` 字串替換成 `max_completion_tokens`。
- 把 OpenCode CLI 缺失改成 warning。
- 將 Custom runner 顯示成 OpenCode 或 Codex。
- 讓 Custom connection 再次經過 Codex/OpenCode hello probe。

原因是 Custom endpoint 可能使用 Responses API，而 OpenCode transport 仍固定走 `/chat/completions`，即使參數名稱修正，protocol 與 response/tool-call 格式仍可能錯誤。

## 第二階段必做：真正的 Custom HTTP execution transport

### 目標

`custom_local` 必須有自己的 execution implementation，不得使用：

- `openCodeLocalAdapter.execute`
- `openCodeLocalAdapter.models`
- OpenCode CLI
- OpenCode skill injection
- OpenCode session codec

### 建議實作位置

目前 Custom adapter 定義在：

```text
server/src/adapters/registry.ts
```

目前類似：

```ts
const customLocalAdapter = {
  ...openCodeLocalAdapter,
  type: "custom_local",
  testEnvironment: testCustomEnvironment,
};
```

必須改為真正獨立的 adapter module，至少自行提供：

- `execute`
- `testEnvironment`
- `sessionCodec` 或明確的 Custom session implementation
- `models`
- tool-call / continuation handling
- abort / timeout / error normalization

不能再 spread `openCodeLocalAdapter` 後只覆寫 `testEnvironment`，因為這會保留 OpenCode 的 execute、session、model validation 與 skill injection。

### Protocol 行為

#### OpenAI Responses

```http
POST <baseUrl>/responses
api-key: <key>                 # api_key
Authorization: Bearer <key>   # bearer
```

Request 必須使用 Responses API schema，例如：

```json
{
  "model": "gpt-5.6-luna",
  "input": [...],
  "tools": [...],
  "max_output_tokens": 4096
}
```

不要送出 `max_tokens`。

#### Chat Completions

```http
POST <baseUrl>/chat/completions
```

只有 routing protocol 明確為 `chat` 時才使用這條路徑。

### Credential 安全

- 從 connection grant 的 secret reference 取得 credential。
- 不把明文 key 放入 Agent persisted config。
- 不把 key 寫入 stderr、skill log 或 activity detail。
- 只允許 redirect-safe 的固定 endpoint request。
- 保持現有 company/owner/grant access checks。

### Tool calls 與 Agent loop

Custom runner 至少要能：

1. 發送 system/developer/user input。
2. 解析文字輸出。
3. 解析 tool calls。
4. 將 tool call 交給 Paperclip tool dispatcher。
5. 將 tool result 追加到下一次 request。
6. 支援多輪直到模型完成。
7. 對 provider error、timeout、401、404、429 回傳 adapter-native error。

可參考既有 Agent adapter 的 dispatch/session lifecycle，但不可直接重用 OpenCode execution transport。

### 必測案例

- Custom Responses model 不需要 `codex` 指令。
- Custom Responses request 不包含 `max_tokens`。
- Custom Responses request 使用 `max_output_tokens`。
- Custom Chat model 只在 protocol=`chat` 時使用 `/chat/completions`。
- Custom API key 使用 `api-key` header。
- Custom bearer 使用 `Authorization` header。
- Custom none 不帶 credential header。
- stderr 不出現 OpenCode skill injection。
- agent run 不依賴 OpenCode CLI。
- tool call 可以完成至少一輪 dispatch/continue。
- session resume 不會退回 OpenCode/Codex identity。

### 驗證方式

先跑窄測試：

```sh
pnpm exec tsc --noEmit -p server/tsconfig.json
pnpm exec tsc --noEmit -p ui/tsconfig.json
```

再新增並執行 Custom runner tests，最後確認實際 Agent run 的 request path、headers、body：

```sh
pnpm test:run
pnpm build
```

若 `paperclip-runner` build 因本機沒有 `cargo` 失敗，至少先跑其 TypeScript build，並明確記錄 Rust binary build 尚未驗證；不能宣稱完整 build 通過。

### 目前已知資料狀態

- `twsoft` company 的有效 Company API key connection 為 Responses routing。
- 舊的錯誤 Chat connection 已 revoke。
- 不同 auth/owner/key 的有效連線不可合併。
- 舊 Agent 可能保存 raw model id；Custom adapter runtime 應兼容並正規化為 `paperclip/<model>`，但新 Agent 應從建立時保存正確格式。

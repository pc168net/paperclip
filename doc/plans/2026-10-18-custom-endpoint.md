# Custom Endpoint 完整開發計劃

日期：2026-10-18

狀態：主要流程已完成，進入整合驗證與手動驗收階段。

目前驗證：UI/server TypeScript、107 個指定相關測試、token gates、`git diff --check` 已通過。

未處理項目：兩個獨立的 OpenAPI dependency-replacements endpoint 缺漏，刻意不納入本功能範圍。

## 1. 目標

支援使用者在新增 Agent 時設定 Azure、LiteLLM 及其他 OpenAI-compatible endpoint：

```text
新增 Agent → 輸入名稱 → Custom endpoint → Base URL/auth/API key
→ Fetch models → 選擇 model/deployment → protocol discovery
→ 自動選擇 runtime → 建立 connection → 測試 agent → 儲存
```

官方 OpenAI、Anthropic、Google、xAI 及既有 subscription 流程必須維持原有行為。

## 2. 資安與邊界原則

- API key 使用 password input。
- API key 不得進 query string、URL、localStorage、console、錯誤訊息或一般 log。
- Custom endpoint URL 不得包含 credentials、query、fragment；非 loopback endpoint 必須使用 HTTPS。
- Discovery 與 connection validation 使用 `redirect: "error"`，避免 credential 被轉送到 redirect 目標。
- API key 僅存於 React memory，頁面 reload 後 draft 可失效，需重新輸入 key。
- Discovery 不執行真實 completion，不產生 token 費用或模型副作用。
- Connection 建立前只執行 `GET /models`；runtime compatibility 留給 Agent test。

## 3. Phase 1：Custom endpoint discovery

### Server

新增：

```text
POST /api/companies/:companyId/ai-connections/custom/discover
```

Request：

```json
{
  "baseUrl": "https://example.openai.azure.com/openai/v1",
  "auth": "api_key",
  "apiKey": "..."
}
```

Response：

```json
{
  "models": [{ "id": "gpt-5.6-luna" }],
  "protocols": { "responses": true, "chat": false }
}
```

實作重點：

- 驗證 company access 與 board 權限。
- `api_key` 使用 `api-key` header；`bearer` 使用 `Authorization: Bearer ...`。
- `GET /models` 回應支援 `data[].id` 及相容的 `models[].id`。
- 以 `OPTIONS /responses` 與 `OPTIONS /chat/completions` 做非消耗性 protocol detection。
- 僅 2xx 視為 protocol 支援。
- 使用 timeout、redirect rejection 及 response body cleanup。

錯誤分類：

| 情況 | 顯示分類 |
|---|---|
| network、timeout、invalid URL | Base URL 無效或無法連線 |
| 401、403 | API key 無效 |
| 404 | Endpoint 不提供 `/models` |
| 429 | Rate limit |
| 非法 JSON | `/models` 回應格式錯誤 |
| 空模型清單 | Endpoint 不支援 model discovery |

### UI

修改 `AgentBasicsDialog`、`AiProviderSetup`、`AiConnectionField`、`NewAgentSetup`：

- 顯示 Custom endpoint 卡片。
- 依序顯示 Base URL、Authentication、API key、Fetch models。
- Fetch 期間顯示 loading；失敗後保留 masked key。
- API key 不寫入 URL 或 localStorage。

## 4. Phase 2：模型選擇與 routing

- Fetch 成功後顯示 searchable/single-select model selector。
- 支援 Azure deployment name。
- 支援手動輸入 model/deployment ID 作為 fallback。
- 沒有有效模型時禁止 Continue/Connect。
- 只保存使用者選取的模型：

```json
{
  "models": [{ "id": "gpt-5.6-luna" }]
}
```

- Azure 的 `model` 值只能是 deployment name，不得使用 URL 或 API key。

## 5. Phase 3：Protocol 與 runtime 自動選擇

對應規則：

| Detection 結果 | 預設 protocol | Runtime |
|---|---|---|
| 僅 Responses | Responses | Codex |
| 僅 Chat Completions | Chat Completions | OpenCode |
| 兩者皆支援 | Responses | Codex |
| 兩者皆失敗 | 禁止繼續 | 無 |

UI：

- 顯示 `Detected` 與 `Runtime`。
- 兩者皆支援時顯示 `Both API formats are supported`。
- 提供 `Change format` 手動覆寫。
- 禁止透過真實 prompt 做自動 detection。

## 6. Phase 4：Draft 傳遞

使用 memory-only draft：

```ts
type CustomEndpointDraft = {
  baseUrl: string;
  auth: "bearer" | "api_key";
  apiKey: string;
  protocol: "responses" | "chat";
  models: string[];
};
```

傳遞鏈：

```text
AgentBasicsDialog
→ React Router location.state
→ NewAgentSetup
→ AiConnectionField
→ AiProviderSetup
```

後續畫面不得再次要求 Base URL、API key、model 或 protocol；draft 不寫入 persistent storage。

## 7. Phase 5：Custom connection 建立

Routing 格式：

```json
{
  "kind": "gateway",
  "protocol": "responses",
  "auth": "api_key",
  "baseUrl": "https://example.openai.azure.com/openai/v1",
  "models": [{ "id": "gpt-5.6-luna" }]
}
```

建立時：

- 只執行 `GET /models` 驗證 endpoint/key/model。
- 不執行 Codex hello probe。
- 不執行 OpenCode completion probe。
- 不執行真實 prompt 或 Agent runtime test。
- 官方 OpenAI 仍固定使用 `https://api.openai.com/v1/models`，不套用 gateway routing。

## 8. Phase 6：Runtime configuration 與 Agent test

### Codex Responses

- `wire_api = "responses"`
- Bearer 使用 `env_key`。
- Azure/API-key auth 使用 `env_http_headers` 的 `api-key`。
- credential 透過 `PAPERCLIP_AI_PROVIDER_KEY` 傳遞。

### OpenCode Chat Completions

- 使用 OpenAI-compatible provider。
- `baseURL` 指向 custom endpoint。
- `apiKey` 由 runtime secret 注入。
- model 使用選定 deployment/model ID。

Runtime test 失敗時使用明確分類：

- Custom endpoint model request failed
- Runtime does not support this protocol
- Model/deployment rejected
- API key rejected by runtime
- Endpoint timeout
- Codex/OpenCode configuration error

## 9. Phase 7：測試計劃

### Server unit/route tests

覆蓋：

- Bearer 與 Azure `api-key` header。
- `data[].id`、`models[].id`。
- Responses、Chat、兩者皆支援、兩者皆失敗。
- 401、403、404、429、timeout、redirect rejection。
- 空模型、非法 JSON。
- API key 不出現在錯誤內容。
- Custom connection 只呼叫 `/models`。
- 官方 OpenAI routing 不受影響。

### UI tests

覆蓋：

- Custom endpoint 卡片與欄位順序。
- password input、loading、錯誤後保留 key。
- model selector、搜尋、fallback input。
- protocol detection、runtime auto-selection、Change format。
- Router state draft 傳遞。
- Custom endpoint 不進 Codex API key wizard。
- API key 不進 URL/localStorage。

## 10. 手動驗證矩陣

### Azure Responses

```text
新增 Agent → Custom endpoint → Azure API key
→ Fetch models → 選 deployment → Responses/Codex
→ 建立 connection → Test agent
```

### LiteLLM Chat Completions

```text
新增 Agent → Custom endpoint → Bearer token
→ Fetch models → 選 model → Chat Completions/OpenCode
→ 建立 connection → Test agent
```

### Official OpenAI regression

```text
新增 Agent → OpenAI → API key
```

確認 endpoint、credential wizard 與既有流程不變。

## 11. 驗收條件

- URL/key 先於 runtime 選擇。
- `/models` 可取得模型且可選 deployment/model。
- protocol 能自動判斷，雙支援時預設 Responses。
- runtime 能依 protocol 自動選擇。
- Custom connection 建立不執行 runtime probe。
- Agent test 才驗證 runtime compatibility。
- 官方 OpenAI 流程不受影響。
- key 不出現在 URL、log、錯誤訊息或 localStorage。
- model、protocol、runtime 不需重複輸入。
- Server/UI TypeScript、相關 tests、token gates、`git diff --check` 通過。

## 12. 已知待辦

目前 OpenAPI coverage 測試另發現既有兩個 endpoint 尚未登記：

```text
GET  /api/issues/{id}/dependency-replacements/candidates
POST /api/issues/{id}/dependency-replacements
```

這不影響 Custom Endpoint runtime，但應另開獨立修正補入 OpenAPI spec，避免 API contract coverage CI 失敗。

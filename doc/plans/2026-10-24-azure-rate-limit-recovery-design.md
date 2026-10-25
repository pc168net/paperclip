# Azure Rate-limit Recovery and Effective Model Display Design

## Intent

讓使用 Azure Responses 連線的 Codex Paperclip Runner，在 Azure 回傳 token rate limit 時，顯示可行動的限流狀態、使用既有受限重試與已設定的 fallback model；同時讓 Agent Overview 與 Agents 清單顯示實際會被執行期連線覆寫後使用的模型。

曾觀察到 provider token rate limit。現行程式只將 `serverOverloaded` 視為 provider capacity failure，因此此類失敗退化為 `adapter_failed`，且不會進入既有的 capacity retry/fallback 流程。

## Goals

- 將已辨識的 Codex provider token rate limit 納入安全且有界的 capacity/rate-limit 分類。
- 對該分類使用既有的兩次延遲重試：第一次 5 分鐘、第二次 15 分鐘。
- 當 Agent 已設定 `fallbackModel` 時，讓 scheduled retry 使用指定的 provider/model；沒有設定時保留原模型。
- 對操作員顯示簡短的「Provider rate limited」狀態與下一步，而不保存或顯示未受限的 Azure 錯誤文字。
- Overview 和 Agents 清單顯示有效模型（effective model）；選取 verified deployment 時，應顯示 deployment model，而不是過時的 `adapterConfig.model`。
- 保留 Agent 設定模型與有效模型的可辨識差異，避免誤以為設定值被靜默覆寫。

## Non-goals

- 不改變 Azure 配額、區域、部署或 API Key。
- 不對未知 Provider 錯誤啟用重試。
- 不增加無限制或立即重試。
- 不重新處理已失敗的歷史 Run。
- 不顯示 Azure 原始 provider 回應、prompt、token、API Key 或連線秘密。
- 不改變 `serverOverloaded`、模型不相容或其他既有錯誤的語意。

## Constraints

- Provider retry 必須維持在 native finalizer 已有的鎖、權限、預算與任務狀態控制下。
- 每個失敗 Run 最多產生兩個 provider capacity retry；不得建立無限循環或平行 replacement Run。
- fallback model 必須是 Agent 明確設定的 `fallbackModel`，不得推測任何同系列模型。
- UI 的顯示必須使用伺服器已解析的安全 metadata；UI 不得推論或接觸憑證。
- 原始 Azure 錯誤只可用作 runner-side 分類，持久化資料採封閉的診斷詞彙。

## Approaches considered

### A. 完整修正：結構化限流分類、既有重試／fallback、有效模型顯示（選定）

在 native provider failure observation 中加入已辨識的 Codex token rate-limit 分類，映射到新的封閉診斷與使用者訊息。使 native finalization 將它交給現有 capacity retry materialization；既有服務負責延遲、上限、wake request、狀態與 fallback model。新增伺服器提供的 effective-model 顯示欄位，供 Overview 與 Agents 清單使用。

**優點：** 解決實際可用性與可見性問題；重用已存在的可審計重試基礎設施。

**代價：** 需要 server、shared API 型別、UI 與測試同步變更。

### B. 僅修正後端限流處理

只分類與重試/fallback，不改變 Overview 或 Agents 清單。

**不選用原因：** 操作員仍會看到已儲存的模型，而非實際執行的 deployment model，持續造成錯誤診斷混亂。

### C. 僅改善 UI 訊息

只顯示 Azure 限流與有效模型，要求使用者手動等待與重跑。

**不選用原因：** 已知、可安全重試的 provider 限流仍被交給使用者處理，違反 harness 負責例行重試的產品原則。

## Design

### 1. Provider failure classification

在 `server/src/services/native-runtime/native-provider-failure.ts` 擴充封閉的 Codex failure 觀察：

- 辨識已辨識的 provider token rate-limit 訊號。
- 僅持久化新的封閉診斷，例如 `{ provider: "codex", category: "rate_limited" }`。
- 回傳穩定 error code 與文案，例如 `native_provider_rate_limited` 和 `Selected model is rate limited. Paperclip will retry after the provider capacity window.`。
- 不保存原始 Azure message、region、deployment 細節或任意 provider response。

分類只適用於權威的 native `turn.failed` / failed terminal 配對，並遵守現有 turn binding。未知、格式不符或標記為 recoverable 的訊號維持現狀。

### 2. Bounded retry and fallback

擴充既有 `native-provider-capacity-retry.ts`，使新的 `native_provider_rate_limited` 走與 provider capacity 相同的受控流程：

- 第一次 retry 在 5 分鐘後。
- 第二次 retry 在 15 分鐘後。
- 最大嘗試次數維持 2。
- retry 使用新的 fresh session，不重播不確定的 provider action。
- `fallbackModel` 僅在明確設定時生效；沒有 fallback 時重試原 provider/model。
- retry 的 context 與 activity 保留原模型、fallback 選擇、嘗試次數與排程時間，但不包含 provider 的任意錯誤文字。

既有 `native_provider_overloaded` 行為不變。可抽出共享的「可受限重試 provider failure」設定，避免將 Azure 限流分支複製成另一套 lifecycle。

### 3. Effective model read model

目前 UI 直接從 `agent.adapterConfig.model` 顯示模型；但執行期連線解析會以 verified deployment 的 `modelId` 覆寫這個值。伺服器應在 Agent read model 中提供：

- `configuredModel`：Agent 儲存的 adapter config model，可為 null。
- `effectiveModel`：若 Agent 綁定可用的 verified deployment，為 deployment `modelId`；否則為 configured model 或既有 adapter default。
- `modelSource`：`verified_deployment`、`agent_config` 或 `adapter_default`。

若兩者不同，Overview 和 Agents 清單顯示 effective model，並以簡短 tooltip 或次要文字標示「Connection deployment」；Harness / Runtime 保持 deployment 為設定來源。這些欄位不包含連線 URL、grant ID 或任何秘密。

### 4. UI failure presentation

native rate-limit run 與 scheduled retry 顯示：

- `Model rate limited` 或等義短文。
- 已排程的 retry 時間與目前是第幾次嘗試。
- 如果有 fallback，顯示下一次將使用的 provider/model。
- 若兩次均已使用，顯示需要操作員確認 provider capacity 後手動重試的行動。

一般失敗頁不呈現 raw Azure text。Provider trace 維持既有權限和紅線規則。

## Files likely to change

- `server/src/services/native-runtime/native-provider-failure.ts`
- `server/src/services/native-runtime/native-provider-failure.test.ts`
- `server/src/services/native-runtime/native-provider-capacity-retry.ts`
- `server/src/services/native-runtime/native-provider-overload.integration.test.ts`
- `server/src/services/heartbeat/runtime-selection.ts`
- Agent API read-model / shared Agent type 的既有定義與測試
- `ui/src/pages/AgentDetail.tsx`
- `ui/src/pages/Agents.tsx`
- `ui/src/pages/Agents.production.tsx`
- 對應的 UI render/unit tests

實作者在開始前需追查 Agent read route 和 shared `Agent` 型別的實際來源，避免新增平行的 client-side model-resolution 邏輯。

## Verification

1. 單元測試確認已辨識的 token rate-limit 訊號產生封閉 rate-limit 診斷，且任意 Azure message 不會持久化。
2. native integration test 確認限流失敗建立一次 5 分鐘的 scheduled retry，並在第二次失敗後建立一次 15 分鐘 retry，第三次不再排程。
3. integration test 確認 configured fallback model 會覆寫 retry 的 provider/model；未設定時保留原 provider/model。
4. integration test 確認重試仍遵守 task ownership、pause、預算與現有 recovery fencing。
5. Agent API test 確認 verified deployment 產生 `effectiveModel`，而未綁定 deployment 的 Agent 仍回傳 configured/default model。
6. UI tests 確認 Overview 與 Agents 清單使用 effective model，並在 configured/effective 不同時顯示來源提示。
7. UI tests 確認 rate-limited run 顯示可行動訊息與排程 retry，而非泛用 `adapter_failed`。

## Builder review

設計已依既有 capacity retry 的鎖、上限與 fallback model 合約檢查。尚未發現需要產品決策的未解項目；實作時唯一需要確認的是現有 Agent read model 最合適的 shared API 投影位置，這不改變對外行為。

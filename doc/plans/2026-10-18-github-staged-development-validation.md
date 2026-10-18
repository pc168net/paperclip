# Paperclip GitHub 分階段開發流程驗證計畫

日期：2026-10-18

## 1. 目的

驗證 Paperclip 是否可以協調以下開發流程：

```text
工程師本機
  ↓ push
GitHub staging repository
  ↓ Paperclip Project 綁定
Paperclip execution workspace
  ↓ AI Agent 開發
AI branch / commit / push
  ↓
工程師本機 fetch / 測試
  ↓
工程師建立 PR 或推送正式 repository
```

本計畫優先使用 Paperclip 現有的 GitHub connection、Project repository、execution workspace、worktree、Issue 和 Artifact 能力；除非驗證發現必要功能缺失，不新增程式碼。

## 2. 重要產品邊界

Paperclip 是 control plane，不應假設它本身就是 GitHub/GitLab 類型的 Git hosting service。Paperclip 負責協調 Project、Issue、Agent、execution workspace、worktree 和執行紀錄；GitHub staging repository 負責 Git remote、branch、commit 和 push。

Repository URL 本身不授權存取。私有 repository 必須由使用者在 Paperclip 的 GitHub connection/OAuth 流程中完成授權。禁止把 GitHub 密碼、PAT 或 SSH private key 放入 prompt、Issue、log 或文件。

## 3. 測試資源

建議建立兩個 GitHub private repositories：

```text
paperclip-calculator-staging   # Paperclip Project 使用
paperclip-calculator-upstream  # 模擬正式來源
```

若測試環境只允許一個 repository，可改用同一 repository 的 staging branch 與 upstream/main，但必須明確記錄這個簡化。

測試程式使用簡單網頁計算機，至少包含：

```text
README.md
index.html
src/
tests/             # 若技術棧適用
```

## 4. Git identity 與權限原則

第一次驗證可使用目前操作人員的 GitHub OAuth connection，但正式協同開發建議改為 dedicated service account。

建議正式權限：

- Agent 可讀寫 staging repository
- Agent 可建立 feature branch
- Agent 不可直接 push 正式 main
- Agent 可建立 PR（如需要）
- 正式 main 由工程師 review/merge

Git commit author、committer 和 push authentication 是不同概念。每個 run 必須記錄實際 GitHub connection、Paperclip 使用者、Agent、Issue、branch 和 commit SHA；不要只依賴 Git commit 顯示名稱追蹤責任。

## 5. 分階段執行規則

每一個 Session **只執行三個 Phase**。完成三個 Phase 後必須停止，不得自行進入下一組 Phase。每次結束都要回報：

- 已完成的 Phase
- 實際操作與結果
- repository、branch、workspace、commit 或 run ID
- 失敗原因與證據
- 下一組 Phase 的前置條件

如果現有功能已支援，不要修改程式碼。若發現缺口，先停止並提出最小修正建議，不要擴大成完整 Git hosting 功能。

---

## 6. Phase 定義

### Phase 0：範圍與環境預檢

確認：

- Paperclip instance 可登入
- GitHub repository URL 已取得
- 測試 repository 是 disposable/private repository
- Paperclip runner 可以連到 GitHub
- 使用者知道 OAuth 必須親自完成
- 不會要求或接收任何 secret

輸出：測試 repository URL、Paperclip instance URL、目前 Paperclip 版本、網路限制和測試假設。

### Phase 1：GitHub connection 授權

由使用者在 Paperclip UI 啟動 GitHub OAuth：

1. Connect GitHub
2. 登入 GitHub
3. 只授權測試 repository
4. 回到 Paperclip 確認 connection
5. 確認 Paperclip 能列出 staging repository

建議最小權限：

- Repository metadata：Read
- Contents：Read and write
- Pull requests：Read and write（只有測試 PR 時需要）

驗收：connection 成功、repository 可見、沒有把 credentials 寫入任何任務內容。

### Phase 2：建立 Project 與 repository binding

建立：

```text
Project: Paperclip Calculator Demo
Repository: paperclip-calculator-staging
Default branch: main
Workspace policy: managed_isolated
```

驗收：

- Project 建立成功
- repository 顯示於 Project configuration
- default branch 正確
- isolated execution workspace 可被選擇或建立

### Phase 3：工程師上傳初始程式碼

工程師本機設定兩個 remote：

```bash
git clone <upstream-url> calculator
cd calculator
git remote rename origin upstream
git remote add paperclip <staging-url>
git push paperclip main
```

若 upstream 尚未存在，可在本機建立初始 commit 後只推送 staging。

驗收：staging repository 的 main 出現初始 source，Paperclip Project 能使用同一版本。

### Phase 4：建立 AI 開發 Issue

建立 Project 下的 Issue，指定 Agent，並使用以下要求：

```text
請在目前 Project 綁定的 GitHub staging repository 中開發。

要求：
1. 使用 Project repository，不要使用無關或未綁定的資料夾。
2. 使用獨立 execution workspace。
3. 從 main 建立 AI feature branch。
4. 完成可操作的網頁計算機。
5. 執行適用的測試或手動驗證。
6. 建立 Git commit。
7. Push branch 回 staging repository。
8. 不得直接 push main。
9. 回報 repository、branch、commit SHA、修改檔案、測試結果和啟動方式。
```

驗收：Issue 綁定正確 Project/Agent，run 開始前有可用 execution workspace。

### Phase 5：驗證 AI workspace、branch、commit 與 push

檢查：

- Agent 實際使用 Project repository
- workspace 是預期的 isolated workspace
- branch 不是 main
- Agent 建立 commit
- Agent push 到 staging repository
- Issue/run 結果包含 branch 與 commit SHA

預期 branch 格式：

```text
ai/<issue-key>-web-calculator
```

驗收：GitHub staging repository 有 AI branch 和 commit，Paperclip Issue 有對應證據。

### Phase 6：工程師下載、測試與回報

工程師本機執行：

```bash
git fetch paperclip
git checkout -b review/<issue-key> paperclip/ai/<issue-key>-web-calculator
```

接著執行專案測試和啟動指令。若 Paperclip workspace 中有重要非 Git 輸出，Agent 必須另外建立 Artifact 或 workspace-file work product；不能只在留言中寫本機路徑。

驗收：

- 工程師可 fetch AI branch
- 程式可在本機啟動
- 測試結果可重現
- 發現問題時能建立 follow-up Issue 或回報原 Issue

### Phase 7：正式 repository promotion

測試通過後，工程師選擇 PR 或人工 merge：

```bash
git checkout main
git pull upstream main
git merge review/<issue-key>
git push upstream main
```

正式環境優先使用 PR，不允許 Agent 直接推送 upstream/main。

驗收：upstream repository 有可追蹤的 PR/merge，且能由 Issue 回溯 staging branch 和 commit SHA。

### Phase 8：Artifact 與交付檢查

確認：

- source code 的正式來源是 Git repository
- 測試報告、截圖、build package 或 release package 使用 Artifact
- Issue 有清楚的 repository、branch、commit、PR、測試與啟動資訊
- 若 workspace 只保留某個重要檔案，已建立 workspace-file work product
- 沒有把 local filesystem path 當成唯一交付方式

### Phase 9：總驗收與結論

產出一份驗證結果：

- GitHub OAuth 是否成功
- Project repository binding 是否成功
- Agent 是否能 clone/fetch
- Agent 是否能 commit/push
- 工程師是否能 fetch/pull
- 本機測試是否成功
- upstream promotion 是否成功
- 目前限制
- 是否需要產品或程式碼修改

若失敗，分類為：

```text
auth / repository catalog / project binding / workspace realization /
runner network / Git credential / branch policy / artifact delivery
```

---

## 7. 可複製給其他 Session 的 Prompt

### Session 1 Prompt：執行 Phase 0–2

```text
你負責 Paperclip GitHub staging development validation 的 Phase 0–2，完成後必須停止。

目標：確認測試環境、完成使用者 GitHub OAuth 授權，並建立綁定 staging repository 的 Paperclip Project。

背景：
- Paperclip 是 control plane，不假設它本身是 Git hosting service。
- 使用 disposable/private GitHub repository。
- 使用者會提供 repository URL，但 OAuth 必須由使用者在瀏覽器親自完成。
- 絕對不要要求或接收 GitHub password、PAT、SSH private key。
- 優先使用既有功能，不要修改程式碼。

只執行：
1. Phase 0：預檢 Paperclip instance、repository URL、runner network 和安全假設。
2. Phase 1：引導使用者完成 GitHub connection/OAuth，確認 staging repository 可見。
3. Phase 2：建立 Project，綁定 staging repository，設定 default branch=main、workspace policy=managed_isolated。

完成後回報：
- 每個 Phase 的結果
- GitHub connection 狀態（不可輸出 secret）
- Project ID/name
- repository name/ref
- workspace policy
- 任何 blocker
- Session 2 執行前置條件

完成 Phase 2 後立即停止，不要建立 Issue，不要執行 Agent，不要進入 Phase 3。
```

### Session 2 Prompt：執行 Phase 3–5

```text
你負責 Paperclip GitHub staging development validation 的 Phase 3–5，完成後必須停止。

前置條件：Session 1 已完成 GitHub connection、Project repository binding，且使用者已準備可 push 到 staging repository 的本機 Git repository。

只執行：
1. Phase 3：引導工程師把初始 source push 到 staging repository 的 main。
2. Phase 4：在 Project 下建立 Issue，指派適當 Agent，使用獨立 execution workspace，並使用計畫中的 Git/workspace prompt。
3. Phase 5：執行 Agent，確認它使用正確 repository/workspace，建立非 main branch、commit 並 push 回 staging repository。

安全與範圍：
- 不要要求使用者貼 credentials。
- 不要讓 Agent 直接 push main。
- 不要修改 Paperclip 原始碼；如果發現功能缺口，停止並記錄缺口。
- 不要進入 Phase 6。

完成後回報：
- staging repository/ref
- Issue identifier/ID
- execution workspace ID/status
- Agent name/run ID
- branch name
- commit SHA
- push 結果
- 失敗證據與分類
- Session 3 執行前置條件
```

### Session 3 Prompt：執行 Phase 6–8

```text
你負責 Paperclip GitHub staging development validation 的 Phase 6–8，完成後必須停止。

前置條件：Session 2 已產生 staging repository 的 AI branch 和 commit SHA。

只執行：
1. Phase 6：引導工程師從 staging repository fetch/checkout AI branch，在本機測試並回報結果。
2. Phase 7：測試通過後，以 PR 或人工確認方式將變更 promotion 到 upstream repository；Agent 不得直接推送 upstream/main。
3. Phase 8：確認 Issue、Artifacts、workspace-file work products、branch、commit 和 PR/merge 資訊完整可追蹤。

安全與範圍：
- 不要要求使用者貼 credentials。
- 不要跳過工程師測試直接 promotion。
- source code 正式來源是 Git；報告、build package 和 release package 才使用 Artifact。
- 不要進入 Phase 9。

完成後回報：
- fetch/checkout 結果
- 本機測試指令與結果
- upstream PR 或 merge commit
- Artifact/work product 連結或缺失
- 尚未解決的問題
- Session 4 執行前置條件
```

### Session 4 Prompt：執行 Phase 9

```text
你負責 Paperclip GitHub staging development validation 的 Phase 9，完成後停止。

請根據前三個 Session 的結果做總驗收，不要重新執行已通過的破壞性操作，也不要修改 Paperclip 原始碼。

請確認並回報：
- GitHub OAuth 授權
- Project repository binding
- execution workspace realization
- Agent clone/fetch、branch、commit、push
- 工程師 fetch/pull 與本機測試
- upstream promotion
- Issue/Artifact/work product 可追蹤性
- 所有失敗的分類與根因
- Paperclip 現有功能是否足以支援流程
- 下一步是設定調整、權限調整，還是需要最小程式碼變更

若所有條件通過，給出可重複使用的正式 SOP；若未通過，給出最小修正計畫，不要擴大範圍成 Git hosting 功能。
```

## 8. 完成定義

此驗證計畫只有在以下條件全部成立時才算完成：

- 使用者可安全完成 GitHub OAuth
- Paperclip Project 可綁定 staging repository
- 工程師可上傳初始 source
- Agent 可在正確 workspace 取得 source
- Agent 可建立 branch、commit、push
- 工程師可下載/checkout AI branch 並測試
- 變更可 promotion 到 upstream repository
- Paperclip Issue 能提供完整可追蹤資訊
- 所有正式交付檔案都有 Artifact 或 workspace-file work product
- 沒有 secret 出現在 prompt、Issue、log 或 Artifact

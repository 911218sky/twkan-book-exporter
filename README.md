# Twkan

使用 Camofox 下載 Twkan 公開小說章節，清理站點宣傳內容並輸出 TXT。

需要 Node.js 22 或更新版本。

## 全域安裝

```powershell
npm install -g twkan
```

安裝後可在任何資料夾直接使用 `twkan`。

```powershell
twkan 90206 --output output/90206
```

### 第一次安裝

需要 Node.js 22 或更新版本。一般 npm 設定下，安裝完成即可使用。

若安裝時顯示 `allow-scripts` 警告，代表 npm 尚未允許 Camofox 等相依套件執行安裝腳本。請執行：

```powershell
npm approve-scripts
```

依畫面允許 `@askjo/camofox-browser` 與 `better-sqlite3`，再以一章測試確認環境：

```powershell
twkan 104807 --limit 1 --output output/test
```

## 使用方式

以書籍 ID 下載整本小說：

```powershell
twkan 90206 --output output/90206
```

以 Twkan 書籍網址下載：

```powershell
twkan https://twkan.com/book/90206/index.html --output output/90206
```

只下載前 10 章作測試：

```powershell
twkan 90206 --limit 10 --output output/90206-preview
```

中斷後重新執行相同命令，已完成章節會從快取繼續，不會重新下載。

## 專案執行

若是從 GitHub 複製專案而不是全域安裝：

```powershell
npm install
npm run crawl -- 90206 -- --output output/90206
```

## 輸出檔案

- `0000-書籍資訊.txt`：書名、作者、分類、狀態、簡介與關鍵詞。
- `0001-章節名稱.txt`：個別章節。
- `書名.txt`：書籍資訊加上全部章節的合併檔。

## 設定檔

可選擇建立自己的設定檔：

```powershell
Copy-Item "$(npm root -g)\twkan\twkanexporter.example.yaml" ".\twkanexporter.yaml"
```

`twkanexporter.yaml` 可調整 Camofox 的連線埠、逾時、分頁與 session 上限。未建立設定檔時，程式會使用內建預設值。

使用自訂檔名或其他位置的設定檔：

```powershell
twkan --config my-settings.yaml
```

若 Camofox 意外未關閉：

```powershell
npm run stop:camofox
```

## 開發檢查

```powershell
npm run check
npm test
```

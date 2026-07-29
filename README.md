# Twkan Book Exporter

使用 Camofox 下載 Twkan 公開小說章節並合併為 TXT。

## 安裝

```powershell
npm install
```

## 下載

```powershell
npm run crawl -- 90206 --output output/90206
```

也可使用網址：

```powershell
npm run crawl -- https://twkan.com/book/90206/index.html --output output/90206
```

只下載前 10 章：

```powershell
npm run crawl -- 90206 --limit 10 --output output/90206-preview
```

## 輸出

- `0000-書籍資訊.txt`：書名、作者、分類、簡介與關鍵詞。
- `0001-章節名稱.txt`：單一章節。
- `書名.txt`：資訊檔與所有章節合併後的完整小說。

中斷後重跑相同指令會使用已有章節快取。

若 Camofox 未正常關閉：

```powershell
npm run stop:camofox
```

## 設定檔

```powershell
Copy-Item twkanexporter.example.yaml twkanexporter.yaml
npm run crawl
```

## 開發

```powershell
npm run check
npm test
```

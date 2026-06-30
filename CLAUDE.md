# ATLAS（筋トレ記録アプリ）— 開発メモ

下田さん個人の筋トレ記録アプリ。最終目標は「課金式で世に出す世界最高水準」のアプリ。

## 構成
- 本体：`index.html`（単一HTML完結アプリ・ビルド不要・localStorage＋IndexedDB保存）
- 他：`sw.js`(Service Worker), `manifest.json`, `icon-192/512.png`
- 公開URL：https://toshi5128.github.io/gym-app/ （GitHub Pages / repo: toshi5128/gym-app）
- カラー仕様：`COLOR_PALETTE.md`

## デザイン指針（厳守）
- 配色＝ゴールド維持。背景=アイボリー`#f1f0ec` / 文字=チャコール`#1c1a17` / 差し色=金属ゴールド`#a8842f`。ライト固定（ダークモード廃止）。
- 絵文字は使わない（ダサい＝NG）。アイコンは線SVGで統一。
- ライムイエロー禁止（Burnfit的なのが嫌い）。クリーン＆余白（Apple Fitness系）の高級感。

## タブ構成
`const TABS=[['log','今日'],['history','履歴'],['stats','分析'],['pl','PL'],['routine','分割'],['more','設定']]`
主要関数（grepで都度確認・行番号は動く）：`renderLog renderHistory renderStats renderRoutine renderMore renderPL buildCalendar ringSVG spark bigChart suggestNext trainStreak`

## 編集・デプロイ手順
1. **編集前に必ずバックアップ**：`cp index.html backups/index_$(date +%Y%m%d_%H%M%S).html`
2. **構文チェック**：`<script>`を抜いて `node --check`（Node: `C:\Users\st106\AppData\Local\Programs\nodejs\node.exe`）
3. **デプロイ**：`bash deploy.sh "コミットメッセージ"`（sw.jsのatlas-vNを自動+1→commit→push）
4. 反映確認：`curl https://toshi5128.github.io/gym-app/sw.js` に新vが出るまで。出なければユーザーに「末尾 `?v=N`」を案内。

## ルール
- このアプリは単独で完結させる。**hikari-app（ひかり不動産）には絶対に触らない**（別案件）。
- 進捗が見えないと不安になる人 → 小さく区切って1行で進捗報告、区切りごとにデプロイして実機確認できるように。
- 終了時・判断を仰ぐ時は通知/明示する。
- 説明は素人前提でかみ砕く（たとえ話・before→after）。専門用語は使ってよいがその都度意味を添える。

## 現在の改善ロードマップ（2026-06-30〜）
筋トレMEMO（赤いアプリ）の構造・使いやすさを取り込む。配色はゴールドのまま。
1. ✅ ホームを負荷量ダッシュボード＋月カレンダーに
2. ✅ 今日タブ再設計：記録動線を最上部・実績は下部「今月のまとめ」へ（v20）
3. ⬜ 種目選択を「部位セクション式」に（色ヘッダーカード＋種目行＋動画アイコン＋すべて表示）
4. ⬜ 履歴に「部位タブ＋カレンダー/グラフ切替」
5. ⬜ 全体の余白・タイポ・タップ領域の最終調整

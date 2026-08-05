# ATLAS（筋トレ記録アプリ）— 開発メモ

下田さん個人の筋トレ記録アプリ。最終目標は「課金式で世に出す世界最高水準」のアプリ。

## 構成
- 本体：`index.html`（単一HTML完結アプリ・ビルド不要・localStorage＋IndexedDB保存）
- 食事タブの計算コア：`keiryo-calc.js`（グローバル `KEIRYO`。`index.html` の inline script より先に読む）
- 他：`sw.js`(Service Worker), `manifest.json`, `icon-192/512.png`
- 公開URL：https://toshi5128.github.io/gym-app/ （GitHub Pages / repo: toshi5128/gym-app）
- カラー仕様：`COLOR_PALETTE.md`

## 食事タブ（減量機能）
仕様書＝`C:\Users\st106\Downloads\KEIRYO-SPEC-v2.md`（v1 より **v2 が正**）。

**設計思想：日単位の完璧主義を捨て、週単位で帳尻を合わせる。**
外食は「失敗」ではなく「計画」として先に週予算へ織り込む。1日超えても警告を出さない。
→ **UI文言に「オーバー」を使わない。** 週予算を超えた時だけ知らせる。

- 計算は必ず `keiryo-calc.js` 経由。**係数（1.75 / 2.4 / 0.72 / 550）を index.html に書かない。**
- テスト：`npm test`（139件）。**ブラウザが読むのと同じ1ファイルを検証している。コピーを作らないこと。**
  数式を直したら必ず `npm test` を通してからデプロイ。
- **集計は必ず `m.d`（その記録が属する1日）で行う。`m.at`（実時刻）は表示専用。**
  深夜0:30の食事を `at` で集計すると前日と当日の両方が壊れる（境界は既定4:00・設定で変更可）。
- **体重は ATLAS の `bw` を共用。**食事タブで二重に入力させない（`bw` は `{date,kg,bf?,ref?}`）。
  `ref:true`＝参考値。7日移動平均から除外される。
- **判断は生の体重で行わない。必ず7日移動平均**（`mealAvg`）。
- **P と F はいかなるカロリー調整でも減らさない。** 調整はすべて C（下限100g）。
- 下限ガードは「その日の目標」ではなく **週平均** で判定する（日次だと外食週に毎週誤警告が出る）。
- **水分**：`drinks` / `drinkPresets`。目安は `体重×35ml ＋ トレ時間×500ml/h`（ATLAS の `sessionMinutes` を流用）。
  飲み物の kcal はその日の合計に入れる（カフェオレ等）。プロテインの水は kcal 0＝粉は食事側で記録済み（二重計上を避ける）。
  カフェインは1日400mg目安＋就寝6時間前チェック（`settings.nutri.bedHour`、既定2時）。
  **医学的助言ではなく目安**である旨を画面に明記している。消さないこと。
- データ：`meals` / `mealPresets` / `myFoods` / `drinks` / `drinkPresets`（`collectPayload`・`applyPayload`・`saveAllLocal` に登録済み）。
  設定は `settings.nutri`（bfPct/activity/deficit/targetBf/boundaryHour/eatOutDow/eatOutKcal/cond/overrideKcal）。

## デザイン指針（厳守）
- **エメラルド×クリーム版（2026-07-08〜）**：金×緑×黒×白。**背景＝深いエメラルド**`--bg:#0e2c22`（glow`#153a2c`）／**カード＝金みの白（クリーム）**`--surface:#e9dfc2`（副`#e0d4b2`/チップ`#e5dabb`）／**カード内の文字＝濃いチャコール**`--txt:#1c1a17`（副`#5a5347`/薄`#8a7f6a`）／主役＝ゴールド`--blue:#a8842f`。トークンは `:root[data-theme="light"]` に定義（命名は名残・applyThemeが常にlight固定）。
- **地の上と中で文字色が違う**：緑地の上に乗る要素（ヘッダー`.brand`／`.eyebrow`／`.fade-in>.hint`／`.empty`）は**ライト**に個別上書き。カードの中は濃い文字。→ 新しく緑地の上に直接テキストを置く時は要ライト化。
- **緑は「伸び・達成」の差し色**：`--pos:#1f7a52`（クリーム上で映える深緑）＝先週比プラス(`.wk-sub.up`)・PR更新数。金＝ロゴ/ボタン/アクティブタブ/自己ベスト演出(`.prflash`＝金の箱)。
- ライムイエロー禁止（Burnfit的なのが嫌い）。深いエメラルドのみ。クリーン＆余白（Apple Fitness系）の高級感。
- 絵文字は使わない（ダサい＝NG）。アイコンは線SVGで統一。
- 変遷：旧アイボリーライト固定 → エメラルド地×白文字 → **エメラルド地×クリームカード×濃い文字**（現行。下田さんの「カードは金みの白」希望）。ブラウザ実描画で今日/分析タブの可読性検証済。

## タブ構成
`const TABS=[['log','今日'],['meal','食事'],['history','履歴'],['stats','分析'],['pl','PL'],['photos','変化'],['more','設定']]`
主要関数（grepで都度確認・行番号は動く）：`renderLog renderMeal renderHistory renderStats renderPhotos renderMore renderPL buildCalendar ringSVG spark bigChart suggestNext trainStreak`
食事タブの主要関数：`nutriCfg nutriPlan mealLogDate mealAvg mealWeekPlan mealWeekIntakes mealDayTarget logMealPreset openManualMeal syncPresetSummary`

## 編集・デプロイ手順
1. **編集前に必ずバックアップ**：`cp index.html backups/index_$(date +%Y%m%d_%H%M%S).html`
2. **構文チェック**：`<script>`を抜いて `node --check`（Node: `C:\Users\st106\AppData\Local\Programs\nodejs\node.exe`）
3. **テスト**：`npm test`（keiryo-calc.js を触ったら必須）
4. **デプロイ**：`bash deploy.sh "コミットメッセージ"`（sw.jsのatlas-vNを自動+1→commit→push）
   ※ `keiryo-calc.js` は `sw.js` の ASSETS に入っている。新規ファイルを足したら ASSETS にも追加すること。
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

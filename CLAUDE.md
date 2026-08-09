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
- テスト：`npm test`（182件）。**ブラウザが読むのと同じ1ファイルを検証している。コピーを作らないこと。**
  数式を直したら必ず `npm test` を通してからデプロイ。
- **定型セット（1食目/間食/2食目/3食目）の正 = `C:\Users\st106\Downloads\1日のメニュー表.pdf`。**
  v84 で「2026-08-07 味噌汁・豆腐なし版」に合わせた。合計2,155kcal・P175・C267。
  ★脂質48gで下限58g（体重×0.7）を下回ったまま＝脂質源を足す時は `tests/presets.test.js` の期待値も更新する。
  この版から最大の食事は 2食目 ではなく **3食目（トレ後）**。味噌汁・豆腐・鮭・ヨーグルトはセットから外れた（食品としては残存）。
  **2026-08-09：卵は1食目にまとめず 1食目/2食目/3食目に1個ずつ**（本人の希望）。1日3個は変わらず合計値も同じ。移行＝`migratePresets3()`。
  **2026-08-09：納豆は3食目（深夜）→1食目へ**（本人の希望）。移行＝`migratePresets4()`。1日合計は 2,155kcal・P175・F48・C267 のまま不変。
- **既存ユーザーへの反映は `migratePresets2()`（index.html）で行う。無条件で上書きする方式。**
  mig1 のような「触っていない人だけ」条件を付けると、端末で少しでも編集していた人に静かに何も起きず
  「直したはずなのに変わらない」になる（腹の種目で実際に起きた）。次にセットを変える時も同じ方式で `presetMig5` を足す。
  ※ `migratePresets3()`（卵の分散）/ `migratePresets4()`（納豆を1食目へ）は「条件を付けない」は踏襲しつつ、**丸ごと上書きではなく動かす食材の行だけ直す**。
    本人が後から足した食材（脂質源など）を巻き添えで消さないため。局所的な変更ならこちらの書き方でよい。
  ※ 移行は**食事タブを開いた時**に走る（`mealPresetList()` 経由）。今日タブのままでは反映されないので確認時は注意。
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
- **タブの役割は1つずつ**：食事＝記録だけ／分析>からだ＝変化のグラフと体重入力（**入力口はここ1箇所**）／設定＝食事の設定。入力欄を2箇所に作らないこと。
- **サプリ**：`supps`（{日付:[id]}）/ `suppPresets`。カロリーは数えない（飲んだかどうかだけ）。
  項目は `{id,name,dose,timing,note}`＝何粒・いつ飲む・効果。設定＞サプリメントで全部編集できる。
  **サプリの中身を変える時は id を変えない**（id を変えると過去の「飲んだ」記録が別物になって消える）。
  2026-08-09：フィッシュオイル→**オメガ3（EPA・DHA）**に差し替え（id は `fishoil` のまま）。移行＝`migrateSupps1()`。
- 記録の時刻は一覧から直せる（`setRecordTime`）。日付(`d`)は動かさず時刻だけ付け替える。
- データ：`meals` / `mealPresets` / `myFoods` / `drinks` / `drinkPresets` / `supps` / `suppPresets`（`collectPayload`・`applyPayload`・`saveAllLocal` に登録済み）。
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

### Pages の配信について（2026-08-06 に方式変更）
- **旧方式(legacy＝ブランチから自動ビルド)が「Page build failed」で全滅したため、新方式(GitHub Actions)へ移行した。**
  設定は `build_type: workflow`、ワークフローは `.github/workflows/pages.yml`。
- **`.github/workflows/pages.yml` を消さないこと。**消すと配信が止まる。
- `.nojekyll` あり（Jekyll処理を飛ばす）。
- 反映確認：`curl https://toshi5128.github.io/gym-app/sw.js` に新しい atlas-vN が出るまで（通常3〜4分）。
- 詰まった時の調べ方（git の認証情報でAPIを叩ける）：
  `TOK=$(printf "protocol=https
host=github.com

" | git credential fill | sed -n 's/^password=//p')`
  → `curl -H "Authorization: Bearer $TOK" .../actions/runs?per_page=1` で実行状況、
    `.../pages` で配信設定を確認できる。**トークンは絶対に画面に出さない。**
- **run が `waiting` のまま固まったら、それを cancel しないと後続が永久に `pending`。**（2026-08-06〜07 の GitHub 障害時に実際に発生。
  障害中に投げた run が environment `github-pages` を掴んだまま6時間半ゾンビ化し、concurrency group `pages` が塞がって v81〜83 が配信されなかった。）
  → `POST .../actions/runs/<id>/cancel` で古い run を落としてから `POST .../actions/workflows/pages.yml/dispatches` を投げ直す。
  status が `waiting`/`pending` の時は**認証やワークフロー設定を疑う前に、まず GitHub 側の障害**を `https://www.githubstatus.com/api/v2/summary.json` で確認する。
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

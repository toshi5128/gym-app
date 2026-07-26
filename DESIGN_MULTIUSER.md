# ATLAS 発展設計：複数ユーザー化 → コーチング → ウェアラブル連携（2026-07-08）

下田さん（オーナー）の意図：
1. **「みんなが使える公開アプリ」**にする
2. オーナーは**"全員の進捗が見える管理画面"**を持つ（コーチが生徒を見るモデル）
3. 将来、**Apple Watch等スマートウォッチと連携**し、心拍・計測時間・睡眠などもクラウドで一元管理
最終ゴール（CLAUDE.md）＝「課金式で世に出す世界最高水準のアプリ」。

---

## 全体像：3段ロケット（作り直さず"増築"で育てる）

最重要方針：**今のHTMLアプリ資産をゼロから作り直さない。** 各段で"使える成果物"を出しながら増築する。

```
【3段目】ネイティブ化 → Apple Watch連携（価値が固まってから）
   ・Capacitorで"今のHTMLアプリをそのまま"App Store配布アプリに包む
   ・Appleの健康データ(HealthKit)にアクセス→心拍/睡眠/ワークアウト自動取込
        ▲ 既存UI・機能は一切作り直さない
┌──────────────────────────────────────────────┐
│【2段目】ウェアラブル"受け皿"をクラウドに設計（1段目と並行・低コスト）│
│   ・どの経路でデータが来ても受け止められる箱を先に用意        │
├──────────────────────────────────────────────┤
│【1段目】ログイン＋各自同期（土台）＋ オーナー管理画面（コーチング）│
│   ・二階建て：1階=各自同期 / 2階=全員進捗の管理画面           │
└──────────────────────────────────────────────┘
        土台（Supabase）＝全段の共通基盤
```

**なぜこの順番か**：Apple Watch連携は難所（後述の壁）。アプリの価値（同期・コーチング）が固まる前に投資すると遠回り。土台→価値→自動計測の順で、止まらず前進が見える形にする。「自動取得が本質・手入力は補完」という下田さんの軸にも沿う。

---

## 1段目・1階：ログイン＋各自クラウド同期（★実装済み・ローカル検証OK）

### できること
- 各ユーザーが「ユーザーID＋パスワード」でログイン／新規登録
- 自分の記録がクラウドに保存され、複数端末で同期
- 各ユーザーのデータは本人だけが見える（RLS）

### 実装済みの中身（index.html）
| 部品 | 場所 | 役割 |
|---|---|---|
| Supabase SDK読込 | `<head>`（`@supabase/supabase-js@2` UMD） | クラウド接続 |
| ログイン画面 | `.authgate`（CSS＋HTML） | ID/パス・新規登録⇄ログイン切替 |
| 同期モジュール | `saveAll`直後のJSブロック | 保存2.5秒後にまとめて1回upsert |
| 起動ゲート | `bootSync()` | 未ログイン→ログイン画面／済→自動同期 |
| 既存データ保全 | `pullCloud()`の"seeded" | 初回ログイン時、端末内の記録をクラウドへ |
| ログアウト | 設定→アカウント（`_cloudUser`時のみ表示）| `logoutCloud()` |

### 接続情報（atlas-gym プロジェクト）— 差込済み
- `SUPABASE_URL = https://gwjbpdxsvnbxqktqmuxb.supabase.co`
- `SUPABASE_ANON_KEY = sb_publishable_...`（公開鍵。各自データはRLSで保護）
- 認証：ユーザーID→`<id>@atlasgym.app` の擬似メールに変換（`idToEmail`）。
  ※`.local`はSupabaseが無効判定するため`.app`を採用。メール確認はOFF（擬似メールに送れないため）。

### データの形（1ユーザー1行）
テーブル `gym_state`：`user_id`(uuid,PK) / `payload`(jsonb=記録8種) / `updated_at`(timestamptz)
RLS：`auth.uid() = user_id` の行のみ read/write（各自プライベート）。

### 安全設計
- 鍵が空なら同期オフ＝従来通り（デプロイ影響ゼロ）。※現在は鍵差込済み＝同期ON。
- 保存は即ローカル＋2.5秒デバウンスで1回だけクラウド書込（I/O枯渇回避＝hikari事故の教訓）。
- 写真(IndexedDB)は重いのでクラウド同期の対象外。
- 複数端末衝突はLast-Write-Wins（タイムスタンプで新しい方）。

### ローカル検証結果（2026-07-08）
✅ ログイン画面表示 ✅ サインアップ成功 ✅ gym_stateに8種payload保存 ✅ 読込OK ✅ RLS有効。

---

## 1段目・2階：オーナー管理画面（実装設計）

下田さん専用「全ユーザーの進捗一覧」。コーチが生徒を見るイメージ。オーナーは**閲覧のみ**（他人のデータを書き換えない）。

### データモデル：`profiles` テーブル
| 列 | 型 | 中身 |
|---|---|---|
| `user_id` | uuid（主キー, →auth.users on delete cascade） | 本人＝`auth.uid()` |
| `display_name` | text | 管理画面での表示名（新規登録時に取得。空ならユーザーID代用） |
| `is_admin` | boolean（default false） | オーナー判定 |
| `created_at` | timestamptz（default now()） | 登録日時 |

### ★RLSの罠と回避（重要）
「adminは全員のprofilesを見られる」ポリシーを `profiles` 自身に is_admin 参照で書くと**RLSが自テーブルを参照して無限再帰エラー**になる。
→ 回避＝**`SECURITY DEFINER` 関数 `public.is_admin()`** で判定（RLSをバイパスして所有者権限で is_admin を読む）。
```sql
create function public.is_admin() returns boolean
  language sql security definer stable as $$
  select coalesce((select is_admin from public.profiles where user_id = auth.uid()), false);
$$;
```

### RLSポリシー
- `profiles`：本人は自分の行を read/write（`prof_own`）／admin は全行 SELECT（`prof_admin_read` = `is_admin()`）
- `gym_state`：既存の本人ポリシーに加え、admin は全行 SELECT（`gym_admin_read` = `is_admin()`）。**書込は各自のみ（adminも他人の書換不可）**

### 新規登録時に profile を自動作成（トリガー）
`auth.users` に行が入ったら `profiles` を自動作成（Supabase標準パターン）。表示名は signUp の metadata から。
```sql
create function public.handle_new_user() returns trigger
  language plpgsql security definer as $$
begin
  insert into public.profiles(user_id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

### アプリ側の変更
- **新規登録画面**に「表示名（ニックネーム）」入力を追加 → `signUp({email,password,options:{data:{display_name}}})` で渡す。
- **管理画面**（`is_admin()` が真のユーザーだけに表示。一般ユーザーには一切見えない）：
  - 全ユーザー一覧：表示名/ID・最終更新日・記録日数・今週のトレ回数・総ボリューム
  - 各ユーザーをタップ→個別の履歴・自己ベスト・体重推移（読み取り専用）
  - 実装は `profiles` と `gym_state` を admin 権限で全件取得して集計表示。

### オーナー指定の運用
下田さんが本番で自分のIDを登録 → その `user_id` の `profiles.is_admin` を `true` に更新（初回だけSQLで手動指定）→ 管理画面が出現。

---

## 2段目：ウェアラブル連携の"受け皿"設計

### 大前提：Apple Watchには特別な壁がある
今のATLASは**ブラウザで動くPWA**。この形のままでは**Apple/iPhoneの健康データ(HealthKit)を直接読めない**（Appleの仕様。HealthKitはネイティブアプリ専用）。
→ Apple Watchの心拍/睡眠/ワークアウトを取り込むには、**3段目のネイティブアプリ化が必要**。

一方 **Garmin / Fitbit / Google Fit** はWeb API公開＝ブラウザアプリ（サーバー経由）でも取得可能。

| 連携先 | 今のPWAで取れる | 経路 |
|---|---|---|
| Apple Watch / iPhone健康 | ❌ | ネイティブ化(HealthKit)が必要＝3段目 |
| Garmin / Fitbit | ⭕ | OAuth＋各社Web API（サーバー経由） |
| Google Fit | ⭕ | Web API |
| 手入力 | ⭕ | 補完 |

### 受け皿（クラウド側テーブル案）※取込経路と分離して先に設計
時系列データは量が多いので `gym_state`(jsonb) とは別テーブルに分離：
- `wearable_workouts`：user_id / date / source(apple/garmin/manual) / type / start / end / duration_sec / kcal / avg_hr / max_hr
- `wearable_hr`：user_id / workout_id / t(timestamptz) / bpm  ※心拍時系列（任意・量注意）
- `wearable_sleep`：user_id / date / bedtime / waketime / duration_min / quality
- `wearable_daily`：user_id / date / steps / kcal / active_min / stand
すべてRLSで各自のみ（2階のadminは閲覧可ポリシー追加）。
**設計の肝＝「受け皿」と「取込口」を分離**。受け皿は今から作れる。取込口(下記)は段階的に差し替え。

---

## 3段目：ネイティブ化 → Apple Watch連携

### 方法：Capacitor（"今のアプリをそのまま殻に包む"）
- ゼロから作り直さず、**今のHTML/JS/UIをそのままiOSアプリ化**できる技術。
- 増築した"Apple公認の外壁"からHealthKitにアクセス→Apple Watchデータを取込→上記受け皿テーブルへ保存。
- 既存のログイン/同期/コーチング資産は**100%再利用**。
- App Store配布・Apple Developer登録（年額）が必要。

### 補足（早く試したい場合の簡易策）
ネイティブ化前でも、Appleの「ショートカット」やヘルスケア書き出しで半自動的にデータをクラウドへ送る簡易連携は一応可能（不安定・手間）。本命はCapacitor化。

---

## プライバシー・責任（公開前に必ず整える）
- オーナーが全員のデータを見られる＝運営者の責任。公開時は「あなたの記録は運営者が閲覧できます」と**明示（プライバシー案内）が必須**。
- 健康・心拍・睡眠は**機微情報**。ウォッチ連携時は取得範囲の同意取得・安全な保管を徹底。
- 課金時は特商法・利用規約・プライバシーポリシー整備（公開フェーズ）。

---

## 実装フェーズ（チェックリスト）

**【1段目】土台＋コーチング**
- [x] ①土台：Supabaseプロジェクト作成 → `gym_state`＋RLS → Auth(メール確認OFF) → URL/鍵差込 → ローカル検証（✅2026-07-08）
- [ ] ②各自同期の実機テスト：ログアウトボタン設置(済) → **デプロイ** → スマホ＆PCで同期確認 ← 今ここ
- [ ] ③2階の設計確定：管理画面の項目・見せ方
- [ ] ④`profiles`・admin RLS 追加（表示名/admin判定/オーナー全件SELECT）
- [ ] ⑤オーナー管理画面 実装

**【2段目】ウェアラブル受け皿（1段目と並行）**
- [ ] ⑥受け皿テーブル設計・作成（wearable_*）＋RLS
- [ ] ⑦取込口フェーズ1：手入力／対応サービス(Garmin/Fitbit/Google Fit)の検討・PoC

**【3段目】ネイティブ化＋Apple Watch**
- [ ] ⑧Capacitorで既存アプリをiOSアプリ化（UI再利用）
- [ ] ⑨HealthKit連携→Apple Watchの心拍/睡眠/ワークアウトを受け皿へ
- [ ] ⑩App Store公開準備（Developer登録・審査）

**【公開・コンプライアンス】**（本章Cと対応）
- [ ] ⑪プライバシーポリシー・利用規約のドラフト作成（Claude Codeが叩き台）
- [ ] ⑫同意フロー実装（規約/PP同意＋健康データの別途明示同意）＋退会時データ削除導線
- [ ] ⑬セキュリティ実装確認（RLS最小権限・監査ログ・XSS対策・service_role鍵の非露出）
- [ ] ⑭薬機法回避（診断/助言をしない・医療目的でない旨明記）＋HealthKitルール遵守
- [ ] ⑮課金する場合：特商法表示・決済代行（Apple/Google/Stripe）導線
- [ ] ⑯**【必須】公開直前に弁護士レビュー**→指摘反映してから公開

---

## メモ
- 実装は Claude Code 側が担当。土台コードは `index.html` に実装済み・構文チェック済み・バックアップ済（`backups/index_20260708_195204_before_keys.html` 他）。
- Supabaseプロジェクト：`atlas-gym`（ref `gwjbpdxsvnbxqktqmuxb`／組織 V1's Org・Free）。
- ローカル検証用テストアカウント（testuser@atlasgym.app, probe*@…）が残存。公開前にSupabase Authから削除する。
- 私のMCPブラウザは下田さんのデスクトップに映らなかった→Supabase操作は「画面共有＋私が代行」で実施できた。

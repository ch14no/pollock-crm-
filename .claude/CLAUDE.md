# pollock-crm 引継ぎメモ（.claude/CLAUDE.md）

## 2026-09-03: M&A事業部（酒田さん）追加依頼7項目「商談画面の改善」実装・本番デプロイ済み（`fc8c64f`、050適用済み）

フェーズ1〜4完了後、酒田さんから新たに7項目の修正・追加依頼（画像添付）が届き対応。

1. **「商談」→「案件」表記変更**: `activities`（049の`counterpart_type`）と同じ「全事業部共有UIに一事業部だけの用語要望」問題。文字通り全社一律で変えると他事業部（IT/人材/財務支援/メディケア）の呼称まで変わってしまうため、**`divisions.deal_term`列を新設し事業部ごとに呼称を上書きできる仕組みを構築**（M&A事業部のみ`'案件'`にシード、他は既定値`'商談'`）。`useDealTerm()`フック（`src/hooks/useDealTerm.ts`、`activeDivision.deal_term`を読むだけ）を作り、サイドバー・ボトムナビ・商談カンバン・DealModal・ダッシュボード・設定画面など約20ファイルの UI 文言を動的化。着手前にAskUserQuestionで「全社一律 or M&A限定の新規構築」を確認し、後者を選択。
2. **対応期日の日付ピッカー連続遡り不可**: ブラウザ標準`<input type="date">`の仕様（CSS/JSでは調整不可）のため、**`react-day-picker`（新規依存追加、`date-fns`は既存依存で互換）を導入**し`MilestoneDatePicker`（`src/components/ui/`）を新設。`captionLayout="dropdown"`で月・年を直接選べるようにし「連続クリックで遡る」操作自体を不要にした。着手前に「新規ライブラリ導入 vs 現状維持」を確認。
3. **「対応期日」→「対応期日・対応済」+チェックボックス**: `deal_milestones.completed_at`（NULL=未対応）を追加。従来は`due_date`が空になると行自体を削除する設計だったため、日付と独立してチェックだけ入れられるよう`upsertDealMilestone`のロジックを変更（削除条件は「日付・チェックの両方が最終的に空になる」ときのみ、呼び出し元が判断）。
4. **「案件情報」表記+モーダル幅拡大**: M&A事業部の商談編集モーダルタイトルを「編集」ではなく「案件情報」という固有の文言に（他事業部は従来通り`{呼称}を編集`）。`Modal`の`size`を`md`→`lg`に変更し入力欄を拡幅。
5. **ステージに「マッチング」追加**: 調査の結果`stages_manage`RLS（006）はmanagerにもステージ管理を許可していたが、**`DivisionStagesPanel`が長らくsuper_admin専用ブロックの中にしかなくmanagerが到達できていなかった**（`TaskStagesPanel`等で以前修正した既知パターンの再発）。マネージャー設定ブロックにも追加し、以後は東さん・酒田さん（manager以上）が設定画面から自分でステージ追加できる。
6. **希望価額の数値化**: `deal_seller_conditions.desired_price_thousand_yen`（NUMERIC）を新設し、自由記述の「希望譲渡対価」を千円単位の数値入力＋自動カンマ整形に変更。既存の自由記述データ（例:「持分価額3.4億円（手取り2.5億）」）は`desired_price`列ごと残し、フォーム上は読み取り専用の「（旧データ）」注記として表示（データ消失なし）。
7. **案件の削除**: 調査したところ**既に完全実装済み・ロール制限なしで動作していた**（040適用後）。追加対応不要、位置が分かりにくいだけと判断し、その旨を回答。

**`/code-review`で4件修正**:
- 期限アラートcron（`api/cron/deadline-alerts/route.ts`）が`completed_at`を見ておらず、対応済みマイルストーンにまで期限通知を送り続ける → `.is('completed_at', null)`を追加。
- `DealMilestonesSection`の`handleUpdate`が日付のみの編集でも「現在の完了状態」を毎回booleanに合成して`upsertDealMilestone`へ渡していたため、日付だけ編集するたびに`completed_at`が「今」に再スタンプされ、本来の対応済み日時が上書きされ続ける不具合 → `completed`は実際にチェックが操作されたときだけ渡す（undefinedのまま透過）よう修正、削除要否の判定は値を全部知っている呼び出し元に集約（`shouldDelete`を明示的に渡す方式に変更）。
- 対応済みチェックボタンの`aria-label`が「対応済みにする」のような汎用文言のみで、スクリーンリーダーでは複数のマイルストーン行を区別できない → `type.name`を含める、`MilestoneDatePicker`にも`milestoneLabel`props追加。
- 「案件情報」表記の判定が`dealTerm === '案件'`という**カスタマイズ可能なラベル文字列**への一致に依存しており、将来他事業部がたまたま同じラベルを設定すると意図せず巻き込まれるリスク → `activeDivision?.name === 'M＆A事業部'`という事業部名そのものでの判定に変更。

**教訓**: 「一部の事業部だけの表記変更依頼」は`activities.counterpart_type`（049）で確立した「共有UIの文言を事業部ごとにカスタマイズ可能にする」パターンを再利用できた。今後も同種の依頼が来たら、まず「全社一律で問題ないか」をユーザーに確認する（一律なら小さい変更、事業部限定なら`divisions`への新規列＋読み取りフックのパターンで対応）。

フェーズ1〜3に続き最終フェーズ。これで酒田さんからの4項目の要望すべてが実装・デプロイ完了。

- **商談日時**: 既存の`action_date`を「開始日時」として引き続き使用し、新たに`end_at`（終了日時、任意）を追加。`action_date`は001から全事業部で使われている列のためリネームは回避。
- **件名→顧客属性**: `activities`は全事業部・全活動タイプ（電話/メール/面談/メモ/タスク）共有のテーブルのため、文字通り件名を全廃すると他事業部のタスク作成（タイトル必須・カンバン表示に使用）が壊れる。**ユーザーに確認した上で「対象が商談かつタスク以外」の場合のみ件名を顧客属性選択に置き換える設計に変更**（AskUserQuestionで3案提示し「商談向けの記録だけ置き換え」を選択）。件名(title)列自体は削除せず、新設の`counterpart_type`列と表示を出し分ける方式（020の`memo_category`と同型）。顧客属性の選択肢は事業部別マスタ（`division_counterpart_types`）とし、汎用デフォルトは持たせずM&A事業部にのみ「売主/買主/提携先」をシード。

**`/code-review`を2ラウンド実施（計10体のfinderエージェント）、致命的な配線漏れ1件を含む多数の指摘を修正:**
1. **【最重要】商談編集画面のどこにも「活動を記録する」の入口が無く、`openActivityModal`に`dealId`を渡す呼び出しがコードベース中に1つも存在しなかった** → `isDealActivity`が常にfalseになり、顧客属性機能全体が本番で到達不能なdead codeだった（3人目のfinderが呼び出しチェーンを全11箇所トレースして発見）。`DealModal.tsx`に「この商談の活動を記録する」ボタンを新設して解消。
2. 終了日時が開始日時より前でも保存できてしまう→送信時バリデーション追加（`min`属性は補助のみ、本チェックはhandleSubmit側）。
3. 顧客属性の取得完了前に件名⇄顧客属性欄が切り替わり、入力中の件名が消える競合状態→取得完了フラグ（`counterpartTypesLoaded`）でUI確定を遅延。
4. モーダル再オープン時に前回の事業部の顧客属性が一瞬残る→フェッチ開始前に同期的にリセット。
5. `createActivity`が049未適用環境で新2列を黙って保存できない構造的リスク（複数列同時欠落時に取りこぼす単純forループ）→`while`+`Set`ベースの取りこぼしないリトライに変更、`strippedFields`を返すよう変更（`deal_seller_conditions`で確立した方式を踏襲）してUI側で警告表示。
6. 活動一覧の検索が`counterpart_type`を見ておらず、件名の代わりに顧客属性だけ入れた活動が検索で見つからない→検索対象に追加。
7. ダッシュボード（`RealtimeTimeline.tsx`・`dashboard/page.tsx`のMyActivityList）が`title`のみ参照しており、顧客属性のみの活動（メモ無し）が画面から丸ごと消える→顧客属性バッジのフォールバック表示を追加。
8. 相対時刻＋終了時刻の混在表示（「3時間前〜09:00」）が意味不明→終了日時がある場合は絶対表記に統一する`formatActivityTime`ヘルパーを新設。
9. `DealModal`を開いたまま`ActivityModal`を重ねて開いていたため、Escapeキー1回で両方閉じる・背景スクロールロックの後始末が狂う不整合（`Modal`コンポーネントがモーダルの重ね掛けを想定していないため）→ボタン押下時に先に`DealModal`を閉じてから`ActivityModal`を開く方式に変更。
10. 設定画面に`division_memo_categories`と同型のCRUD管理画面（`CounterpartTypesPanel`、既存の`DivisionCategoryPanel`汎用コンポーネントを再利用）が無く、M&A事業部のシード3件以外を自事業部で追加できなかった→追加。

**未対応のまま残した指摘（低〜中、意図的に見送り）**: `OPTIONAL_ACTIVITY_COLUMNS`のリトライロジックが`deals.ts`/`conditions.ts`と3つ目の独立実装になっている（アーキテクチャ統合は将来検討）／`isMissingColumnError`の部分文字列一致が将来NOT NULL制約等を追加した際に誤検知しうる（現状は全列nullableのため顕在化しない）／インライン編集経由で顧客属性を持つ活動に件名を追加できてしまう組み合わせ状態（データ破損ではなく表示上の重複のみ）。

**教訓**: 新機能のUIを既存の共有インフラ（今回は`ActivityModal`の`prefillDealId`）に接続する際は、「型は用意されているが実際に値を渡す呼び出し元が存在するか」を`grep`で確認すること。型・store・受け側の分岐ロジックが揃っていても、呼び出し元が1つも無ければ機能は100%到達不能になる——ビルドもtscも通り、レビューの最初の数パスでも見落とされかねない種類の不具合。

## 2026-08-28(2): M&A事業部（酒田さん）フェーズ2+3「買手打診リスト＋AD契・NDA締結管理」実装・本番デプロイ済み（`dab9fff`、047〜048適用済み）

フェーズ1に続き、フェーズ2（買手打診結果一覧）とフェーズ3（AD契・NDA締結管理）を実装。依頼画像で両方が同じ商談詳細画面（売り案件）に表示される想定だったため、まとめて対応。設計はFable 5に壁打ち（曖昧点6件の低リグレットなデフォルト解決込み）。

- **買手打診リスト**（`deal_buyer_prospects`）: 商談編集の「売主」タブに新設。企業名・代表者・業種・事業内容・URL・上場区分・都道府県は`company_id`経由のライブ参照（会社マスタを唯一の情報源にする、フェーズ1のグループ会社紐づけと同じ思想）、行が固有に持つのは所感（`note`）とネームクリア可否（`name_clear`）のみ。`CompanyPicker`をフェーズ1から再利用。CSV出力ボタン付き（依頼どおりの10列: No/企業名・法人名/上場区分/都道府県/代表者名/業種/事業内容/URL/所感/ネームクリア可否）。都道府県は`companies.prefecture`が未入力でも住所文字列からの正規表現抽出（`extractPrefecture`）でフォールバック。
- **AD契・NDA締結管理**: 新テーブルは作らず`deal_seller_conditions`に4列追加（`ad_contract_status`/`ad_contract_date`/`nda_status`/`nda_date`）。既存の`loss_deficit_ok`と同型（可/否、未設定=未確認）で実装（**2026-09-01酒田さん回答: 「締結済みかどうか」の意味で確定、IM送付可否の判断材料のため未定/締結予定等の細かい状態管理は不要とのこと。現行実装のままで要件を満たす**）。
- **会社属性の追加**: `companies.listing_status`（東証プライム/スタンダード/グロース/その他上場/非上場のCHECK付き選択式）・`companies.prefecture`（47都道府県select）。`CompanyEditModal`に追加。

`/code-review`で2件修正（いずれも独立エージェントでCONFIRMED検証済み）:
1. **`upsertSellerConditions`がAD/NDA新4列を既存4項目と同じ1本の`upsert`文に混ぜていたため、048未適用の環境ではAD/NDA分だけでなく希望譲渡時期等の既存項目の保存まで丸ごと失敗する**重大な回帰バグ → `deals.ts`の`OPTIONAL_DEAL_COLUMNS`/`isMissingColumnError`と同じ「列不在エラーを検出してその列だけ落として再試行し、どの列が保存されなかったかを呼び出し元に返す」パターンに変更。`DealConditionsSection`側もstrippedFieldsを見て「AD契・NDA欄は未反映」の警告トーストを出すよう対応。
2. **`DealBuyerProspectsSection`の所感入力が`defaultValue`のuncontrolled inputで、保存失敗時の`loadData()`巻き戻しがDOMに反映されず、拒否された未保存の入力が画面に残り続ける**「幽霊」状態 → `key={`${p.id}-${p.note ?? ''}`}`でp.noteの変化時に強制再マウントし、巻き戻しを確実に反映。

**マイグレーション適用状況**: 047・048を本番適用済み（2026-08-28）。

**残タスク（2026-08-28時点で解消）**: フェーズ4（商談記録フォーム変更）は同日中に実装・デプロイ済み（上の2026-08-28(3)セクション参照）。

**酒田さんへの確認事項5点、2026-09-01付で全件回答受領・すべて追加対応不要と判明**:
- フリガナの入力必須範囲 → 全項目任意入力のままでOK（読みにくい場合の補助的な追記運用の想定とのこと）
- 業種分類の完全版データ投入時期 → サンプルのままでOK、追加要望が出たら都度依頼
- 買手打診リスト・上場区分等の閲覧範囲 → 現状（事業部限定＋super_admin）のままでOK
- AD契/NDA「締結可否」の正確な意味 → 「締結済みかどうか」で確定、現行実装のままでOK（詳細は上のフェーズ2+3セクション参照）
- ネームクリア可否の「未確認」ステータス → **既に実装済み**（`name_clear`がNULLのときUI上「未確認」と表示・選択できる。`DealBuyerProspectsSection.tsx`のselect初期値、CSV出力の`?? '未確認'`フォールバックで対応済み）。酒田さんの依頼時点でこの実装に気づいていなかった可能性があるが、コード変更は不要と確認済み

**M&Aフェーズ1〜4は設計確認も完了し、追加のコード対応なしで要件を満たしている状態。**

## 2026-08-28: M&A事業部（酒田さん）フェーズ1「会社情報拡張」実装・本番デプロイ済み（`8199d6d`、044〜046適用済み）

M&A事業部の酒田さんから東さん経由で4項目の要望（①会社情報拡張 ②買手打診結果一覧 ③AD契・NDA締結管理 ④商談記録フォーム変更）が届き、設計をFable 5に壁打ちさせた上で**フェーズ1（①会社情報拡張）のみ**着手（フェーズ2〜4はユーザーの指示待ち）。

- **業種の大中小階層選択式**: 新テーブル`industry_classes`（TSR/JSIC準拠、大分類=英字1桁/中分類=数字2桁/小分類=数字3桁、自己参照`parent_code`で1テーブルに階層を収める）＋`companies.industry_code`FK。`IndustryPicker.tsx`（`ContactPicker`と同じ検索ポップアップパターン、階層ドリルダウン＋全階層横断検索の両対応）。既存の自由入力`industry`列はDB上残置し、業種マスタ未投入環境向けのフォールバック（`CompanyEditModal`が`fetchIndustryClasses()`の結果件数で表示を出し分け）。**045は酒田さん提供Excelのサンプル37区分のみ**（大分類20・中分類99・小分類394の完全版は未提供、揃い次第`ON CONFLICT (code) DO UPDATE`で追加投入すればよい設計）。
- **事業内容欄**（`business_description`、`AutoGrowTextarea`）、**代表者②**（共同代表対応、`representative2`）、**会社名・代表者①②のフリガナ**（`name_kana`/`representative_kana`/`representative2_kana`）を追加。
- **グループ会社の紐づけ**: 新テーブル`company_group_links`（無向ペア、`LEAST/GREATEST`のUNIQUE INDEXで逆向き重複防止）。`CompanyPicker.tsx`新設（`ContactPicker`同様の検索ポップアップ、ただし選択後は即追加して閉じるだけの単発アクションのため`selectedId`/`onClear`は持たない設計——フェーズ2の買手打診リストでも同じ`CompanyPicker`を再利用する想定）。`CompanyGroupSection.tsx`（会社詳細ページに表示、`DealDocumentsSection`と同じ「セクション自体が例外時は隠れる」フォールバックパターン）。

`/code-review`で4件修正:
1. `updateCompany`が`.select('*')`のままで、保存直後に返るCompanyオブジェクトから`industry_class`（join結果）が欠落し、画面上の業種表示が保存直後だけ消える → `COMPANY_SELECT`（`industry_classes`のjoin込み）に統一。
2. `fetchCompanyById`のエラーを一律nullに丸めていたのを、`PGRST116`（本当に0件）以外は例外を再throwするよう変更 → 044等のマイグレーション未適用時にPGRST201的なembed衝突が起きても「会社が見つかりません」ではなく正しく「読み込みに失敗しました」表示に回るようにした（deals側で2026-08-20に起きたPGRST201の教訓を踏まえた予防的対応）。
3. `CompanyGroupSection`の紐づけ解除が失敗した際（他ユーザーによる同時解除等で0件）、ローカルの`links`一覧が再読込されず「消えたはずのリンクが残ったまま」の幽霊状態になる → catch節でも`loadData()`するよう修正。
4. `IndustryPicker`が独自に`fetchIndustryClasses()`を再フェッチして0件なら自己非表示する設計だったが、呼び出し元（`CompanyEditModal`）が既に同じ判定（`industryMasterReady`）をしているため、両者のフェッチ結果が食い違うと（一時的なネットワーク瞬断等）欄ごと消える不整合になりうる → `IndustryPicker`の自己非表示ロジックを削除し、表示要否の判断は呼び出し元に一本化。

**マイグレーション適用状況**: 044・045・046を本番適用済み（2026-08-28、ユーザーが044→046→045の順で実行したが、046は`industry_classes`に依存しないため問題なし）。

**残タスク（2026-08-28時点で解消）**: フェーズ2（買手打診結果一覧・CSV出力）・フェーズ3（AD契/NDA締結管理）・フェーズ4（商談記録フォーム変更）とも同日中に実装・デプロイ済み（上の2026-08-28(2)・2026-08-28(3)セクション参照）。M&A事業部からの4項目の要望はすべて完了。

> コーディング規約・検証コマンドはリポジトリ直下の `CLAUDE.md`（＋`AGENTS.md`）が正。
> システム全体像は `docs/handover-report.md`、M&A要望24項目は `docs/ma-feedback-progress-report.md` が正。
> 本ファイルは「マイグレーション適用状況・最近の変更・残タスク・デプロイ方法」の引継ぎ用。

## デプロイ
- GitHub `ch14no/pollock-crm-` に push → Vercel が自動デプロイ（本番: https://pollock-crm.vercel.app ）。
- **DBマイグレーションは自動適用されない**。`supabase/migrations/NNN_*.sql` を書いても、Supabaseダッシュボード → SQL Editor に手動で貼って実行する運用。frontendのpushとSQL適用は別手順（コード先行 or SQL先行かは変更内容による）。
- service_roleキーはPostgREST/Auth用でDDL（CREATE POLICY/FUNCTION等）は実行不可。ポリシー/関数変更は必ずSQL Editorでユーザーに実行してもらう。

## 2026-08-25: Google Docsバグ報告（8/25分）5件に対応（`5b66a91`、DBスキーマ変更無し）

1. **顧客管理のソートが効かない**: デフォルト表示の会社別ビュー（`CompanyView`）が会社グループを常に会社名アルファベット順で固定描画しており、一覧側のソート選択（最終更新順・氏名順等）が反映されていなかった。渡された`contacts`配列（既にソート済み）の出現順をそのままグループ順に採用するよう修正。
2. **自分が記入した活動しか編集できない**: `activities_update`（030）は既に同一事業部メンバーへ開放済みだったのに、`activities/page.tsx`・`contacts/[id]/page.tsx`のUI側`canEdit`判定が本人限定のまま——RLSより厳しいUI制限の再発（042と同じ「UIとRLSの不一致」パターン）。RLSに合わせて緩和。
3. **顧客ページ（個別詳細）から削除できない**: 個別詳細ページに削除ボタンを新設（`deleteContact`は040/041で権限・件数確認済み）。
4〜5.（欲を言えばシリーズ）**他ページに移動して顧客一覧に戻ると検索・ソート・表示形式がリセットされる**: `query`/`sortKey`/`viewMode`を`appStore`の`contactsListView`に永続化。「顧客一覧へ戻る」自体は既に`router.back()`実装済みだったため、一覧側の状態保持が実質的な解決になる。**5番の文字通りの要望（サイドバーの「顧客」リンクを押した時に直前に見ていた個別ページへ戻る）までは未実装**——グローバルナビゲーションの挙動を変える判断が要るため、ユーザーに確認してから着手する方針とした。

`/code-review`で3件指摘・修正: ①デモモード（Supabase未接続）で顧客削除が偽の成功になる不具合→`removedContactIds`のローカル除外リストを追加（`removedDivisionIds`等と同じ既存パターン踏襲）②永続化した`sortKey`/`viewMode`が将来の選択肢変更で不正値のまま読み込まれる懸念→検証してデフォルトへフォールバックする`toSortKey`/`toViewMode`を追加③`CompanyView`の会社出現順管理の冗長コード→Mapのキー挿入順で簡略化。

**教訓**: UIのアクセス制御チェック（`canEdit`等）はRLSポリシー変更時に追従し忘れやすい。同一事業部への権限開放（030・042等）をRLS側で行った際は、対応するUIガードも同時に点検する。

### 追記（同日）: 会社詳細ページにも削除機能が存在しなかった（`9e2f634`、043、本番適用済み）

「削除ボタンが見つからない」の再報告を受けて確認したところ、実際には**2種類の「顧客ページ」**が存在し、個人（担当者）詳細ページ（`contacts/[id]`）には削除ボタンを追加済みだったが、**会社詳細ページ（`contacts/company/[id]`、担当者一覧が出てくる方）には削除機能自体が元から存在しなかった**。会社詳細ページに削除ボタンを新設（`deleteCompany`・043 RLSポリシー〔manager/super_adminのみ、companiesは事業部を持たない全社共有マスタのため〕）。`contacts.company_id`/`tossups.company_id`は`ON DELETE SET NULL`のため、会社を削除しても担当者・トスアップ自体は消えず「会社未設定」になるだけで安全。`/code-review`でデモモードの偽成功削除（`deleteContact`と同型）を指摘され、`removedCompanyIds`のローカル除外リストで解消。

**教訓**: 「顧客ページ」等の曖昧な報告は、個人詳細・会社詳細のどちらを指しているか報告者に確認するか、両方確認してから対応する。今回は個人ページだけ直して報告し、再度「まだ無い」と返ってきてから会社ページの存在に気づいた。

## 2026-08-24: Google Docsバグ報告（8/24分）を確認・修正（`683fcc5`、042、本番適用済み・SQLのみでコード変更なし）

Google Docsのバグ・要望管理ドキュメント（画像添付あり、`read_file_content`ではテキスト抽出に画像が乗らないため`download_file_content`でPDFエクスポート→PyMuPDF (`pymupdf`) でページを画像化して目視確認する手法を使用。今後も同ドキュメントで画像付き報告が来たら同じ手順が使える）から、「石川さんの画面と齋藤さんの画面で顧客詳細ページの表示内容が違う」報告を確認。

**原因**: 石川紅さん（一般ユーザー）の顧客詳細ページ（個別contact page）で、齋藤香奈さん（super_admin）が記録した活動履歴（8件）が一切表示されず、自分の記録分（5件）のみ表示されていた。`activities_select`の同一事業部閲覧判定（`shares_division_with(user_id)`）が記録者側にも`user_divisions`行の存在を要求するが、super_adminは所属登録を省略できる設計（2026-07-23の教訓）のため、super_adminが記録した活動は一般ユーザーから不可視になっていた——**2026-07-22に一度直したはずの「同僚の活動が見えない」バグの、super_admin絡みでの再発**。

034で未担当タスク向けに作った`shares_division_with_activity_target`（活動の対象＝顧客/商談のdivision_idで判定、記録者のuser_divisionsに依存しない）を無条件OR分岐として`activities_select`/`activities_update`・`task_meta_select`/`task_meta_update`に追加して解消（`activities_delete`は意図的に対象外、既存の別欠陥があり今回のスコープに含めない）。

**教訓**: 「同一事業部メンバーなら見える」系のRLS判定を書く時は、記録者（owner）側がuser_divisionsに行を持たないケース（super_admin等）を必ず想定する。owner基準の判定だけでなく、対象（ターゲットレコード自体のdivision_id）基準の判定も用意しておくと、この種の「権限を持つはずの人の行動が原因で他の人が見えなくなる」逆説的な穴を塞げる。

**残タスク**: 同ドキュメントには8/24時点で他にも未着手の要望（活動履歴→入力履歴への改称、複数activity_type選択、締切日順ソート、日付の絶対表示、補助金/融資タブでの絞り込み等）が残っている。次回セッションで対応候補。

## 2026-08-24(2): 過去のバグ報告を全期間（5/22〜8/24）棚卸し、未解決3件を修正（`f0cff97`）

ドキュメント全体を3並列のExploreエージェントで実コードと突き合わせ、「✅修正済」表記が古い/矛盾しているものを含め現状を再確認。ほとんどは既に解決済みと確認（名刺OCR実装済み・ソート機能実装済み・活動編集は全タイプ対応済み・通知ボタン実装済み・検索は実装上問題なし・タスクカンバン列のDB共有化済み・幽霊タスク対策済み・担当変更機能実装済み）。**本当に未解決だった3件を修正**:

1. **齋藤香奈さんのダッシュボードが無関係な事業部の数字を表示（5/26報告）**: super_adminは`user_divisions`所属登録を省略できる設計のため、齋藤さんは所属行が0件のままだった。`layout.tsx`のデフォルト事業部選択ロジックが「作成順で一番古い事業部（IT）」にフォールバックし、財務支援ではない数字を見せていた。山﨑さん（同じsuper_adminだが財務支援にprimary所属登録済み）と比較して特定。**対応: コード変更ではなく本番データ修正**——山﨑さんと同じパターンで齋藤さんに`user_divisions`（division_id=財務支援, is_primary=true, show_as_task_assignee=true）を追加。**注意: 既に別の事業部がキャッシュされている端末では自動的には切り替わらない**（`activeDivisionId`はzustand persistでlocalStorageに保存され、super_adminは`ownDivisionIds`=全事業部のため`needsDefaultDivision`判定がfalseになり上書きされない）。齋藤さんには一度手動で財務支援に切り替えてもらうか、ブラウザのサイトデータをクリアしてもらう必要がある。
2. **タスクカードのメモが折り返されない（7/24報告）**: `TaskKanbanBoard.tsx`のメモ表示が`truncate`のままだった。`line-clamp-2 whitespace-pre-wrap`に変更。
3. **ダッシュボードの個人タスクリンクが常にチームビューで開く（5/22報告の残課題）**: `dashboard/page.tsx`のリンクに`?scope=personal`を付与、`tasks/page.tsx`で`useSearchParams`から初期スコープを読むよう変更。`/code-review`で「同一ルート内遷移は再マウントされないため、一度personalで開いた後クエリ無しの`/tasks`リンク（サイドバー等）で戻ると状態が固定される」問題を指摘され、`useEffect`でナビゲーションのたびにURLと同期し直すよう修正。

**教訓**: 「同一事業部なら〜」系のロジック（今回はRLSではなくデフォルト事業部選択ロジック）で、super_adminが`user_divisions`所属登録を省略できる設計との組み合わせによる見落としが再度見つかった（042のRLSバグと同根の設計上の死角）。**新規にsuper_adminアカウントを作る際は、実際に手を動かす事業部があるなら山﨑さんのパターンに倣い`user_divisions`にprimary行を1つ登録しておくことを運用ルールにするとよい。**

## 2026-08-21: タスクカンバンにタブ切り替え機能を追加（`31efb28`、039_task_kanban_tabs.sql、本番適用・デプロイ済み）

齋藤香奈さんから「商談カンバンの『補助金』『融資』タブのように、タスク管理もタブで切り替えたい」と要望。設計はFable 5に壁打ち→実装→`/code-review`（8観点finder）で実害バグ3件を修正済み。

- 新テーブル`task_kanban_tabs`＋`task_kanban_stages.tab_id`列（商談の`pipeline_tabs`と同じ考え方。ただし複合FK1本のみに簡素化——`pipeline_stages`のような単一列FK+複合FKの2本構成はPGRST201の危険な構造なので踏襲しなかった）
- `create_task_kanban_tab`RPCで初回タブ作成時の既存列移行を原子化（商談側の`createPipelineTab→migrateUntabbedStagesToTab`2段書き込みより安全な設計に改善）
- **既存バグ修正が同梱**: `replace_task_kanban_stages`の改修に合わせて、037（`task_stage_user_visibility`）がON DELETE CASCADEで`task_kanban_stages`に紐づいているせいで、列を1つ追加・並び替えするだけで**その事業部の個人ビュー表示列設定が全ユーザー分サイレントに全消えしていた**既存不具合を解消（置換前にスナップショット→置換後に復元）
- `/code-review`で見つかった実害バグ: ①先頭タブの列を全部削除すると迷子タスクの受け皿が消える（`resolveFallbackTaskTabId`で「列を1つ以上持つ先頭タブ」に解決するよう修正）②タブ削除失敗時のエラーメッセージが原因を問わず決め打ち（23503のみ専用文言、それ以外は実エラー表示に変更）③タブ追加ボタンの初期ロード中の競合状態
- **実データで発覚した事実**: 財務支援事業部は既にDB上で22列（補助金系11列＋「【融資】」接頭辞の融資系11列）を1つの横並びで運用しており、まさにタブ機能が解決すべき状況そのものだった。ユーザーには「補助金」タブ作成→既存列の自動移行、「融資」タブ作成→【融資】系列を作り直す、という移行手順を提示済み
- **デプロイでの実地インシデント**: SQL適用時、ユーザーが誤って別プロジェクトのSQL Editorで実行し`relation "public.divisions" does not exist`で失敗→pollock-crmプロジェクトで再実行して解消。**教訓: 複数Supabaseプロジェクトを日常的に扱う運用では、SQL適用前に対象プロジェクトの確認を促す一言を必ず添えること**
- 実機確認待ち: ユーザーによるタブ作成・列移行・ドラッグ動作の確認（本レス時点で未実施）

## 2026-08-21(3): 商談削除が本番リリース以来ずっと機能していなかった不具合を修正（`4165e87`、040_deals_delete_policy.sql、本番適用・デプロイ済み）

齋藤香奈さんから「商談を削除しても一覧に残り続ける」と報告。**画面録画（Google Drive動画）をffmpegでフレーム抽出し画像として確認する方法で調査**（動画そのものは視聴できないため2fpsで20枚のPNGに変換し`Read`で1枚ずつ確認。今後も動画での不具合報告はこの手法が使える）。

- 原因: **`deals`テーブルにDELETEのRLSポリシーが001の初期スキーマ以来一度も存在しなかった**（39回のマイグレーションを全確認）。RLS有効テーブルでDELETEポリシーが無いとPostgresは全ユーザーの削除を無音拒否する。加えて`deleteDeal()`（`lib/db/deals.ts`）が削除件数を確認せずerrorの有無だけを見ていたため、0件削除でも例外を投げず「削除しました」の成功トーストが出ていた。**「商談を完全に削除する」ボタンは本番リリース以来一度も実際には機能していなかった可能性が高い。**
- 修正: `deals_delete`ポリシーを`deals_update`（006）と同じ権限モデルで新設（同一事業部メンバーなら誰でも削除可＋super_admin全事業部）。`deleteDeal()`に`.select('id')`で削除件数チェックを追加（`updateDeal`等の既存パターンに統一）。
- **教訓**: `.select()`を付けずRLS拒否の0件更新/削除を検出できないパターンは、このプロジェクトで`updateDeal`/`updateContact`修正時に一度学んだはずだったが、`deleteDeal`には未適用のまま残っていた。**INSERT/UPDATE/DELETEを新規に書く・レビューする際は、対象テーブルの各操作に対応するRLSポリシーが実在するか（SELECTだけでなく）を毎回確認し、書き込み系関数は必ず`.select()`で影響件数を確認する**、を今後のチェックリストに追加。
- 実機確認待ち: 齋藤香奈さんに実際の商談削除で解消したか確認してもらう。

## 2026-08-21(4): 商談カンバンでドラッグしてもヘッダーの集計が更新されない不具合を修正（`5488116`、DBスキーマ変更無し・コードのみでpush済み）

齋藤香奈さんのスクショ（「進行中4件・見込み額¥3,360,000」が、同じ画面に見えている「未分類9件・¥5,880,000」単体より小さい）から発見。

- 原因①: `KanbanBoard.tsx`の`handleDragEnd`が、DB商談のドラッグ時は`updateDealStage`（DB書き込み）のみ行い`updateLocalDeal`（グローバルストア更新）を呼んでいなかった。ボード自身の見た目（`dealsByStage`）は即時反映されるが、`deals/page.tsx`のヘッダー集計（進行中件数・見込み額合計）は`dbDeals+localDeals`のマージから算出しているため、事業部切替や商談モーダルの開閉（`loadDeals()`再実行のトリガー）まで古いステージのまま集計され続けていた
- 原因②: ①を`updateLocalDeal`呼び出し追加で直そうとしても、`updateLocalDeal`自体が`.map()`による既存エントリ更新のみでupsertに対応しておらず、まだ`localDeals`に一度も乗っていないDB商談（大半が該当）へのパッチは無言で捨てられていた
- **教訓**: `localDeals`は本来「未同期のローカル専用商談」＋「DB商談への一時的な楽観更新パッチ」の二役を担う設計だが、後者の役割は`updateLocalDeal`が`.map`のみ（upsert非対応）だったため実質機能していなかった。DealModal.tsx側の同名の呼び出し（編集・失注・復活）は、モーダルクローズ時の`loadDeals()`が必ず後追いで正しい状態に上書きするため症状が隠れていた。**カンバンのドラッグのようにモーダル開閉を伴わない操作でローカル楽観更新に頼る処理を書くときは、`localDeals`が対象idをupsertできる設計になっているか要確認**。

## 2026-08-21(5): 削除失敗時に画面が実態に追従しない「幽霊カード」不具合を修正（`d456ba0`、DBスキーマ変更無し）

齋藤香奈さんが再度「あるカードだけ削除できない」と報告。まずアカウントがsuper_adminであることをSupabase Auth Admin API（`/auth/v1/admin/users`）で実データ照合し確認（同姓同名の別アカウント等は無し）——権限起因ではないと判明。

真因: `DealModal.tsx`の`handleDeleteDeal`が、`deleteDeal()`がエラーを投げた場合に`removeLocalDeal`/`closeDealModal`を一切呼んでいなかった。財務支援事業部はこの時点で数分で13件→40件に急増するほどデータが激しく動いており、二重クリックや他端末での先行削除で「DBからは既に消えているのに、削除APIの2回目の呼び出しが0件エラーになる」ケースが発生。この時モーダルも背後のカードも画面に残ったまま固定され、開発者側（service_roleでDBを直接見る）には見えない「実DBには存在しないのに操作者の画面にだけ残るゴースト」になっていた。

`deleteDeal()`に0件の理由（権限拒否 or 既に削除済み）を区別するフォローアップSELECTを追加し、既に削除済みの場合は専用の`DealAlreadyDeletedError`を投げる。`DealModal`側はこのエラーの時だけ`removeLocalDeal`/`closeDealModal`を呼んで画面を実態に合わせる（それ以外の真のエラーは従来通りモーダルを開いたまま再試行させる）。

**教訓**: 「操作者の画面で再現するが開発者のDB直接調査では再現しない」不具合は、DB側の状態は正しいのにクライアント側の楽観更新/エラーハンドリングが実態に追従していないケースを疑う。特に成功パスにしか状態クリーンアップ処理が無いcatch節は要注意。

## 2026-08-21(6): エラーハンドリング監査＋トップ3修正（`4f118bc`、041_contacts_delete_division_scope.sql）

商談削除で連続発覚した3パターン（①書き込み系DB関数の`.select()`件数確認漏れ ②失敗時のローカル状態未クリーンアップ＝幽霊カード ③決め打ちエラーメッセージ）を、コードベース全体で横展開監査した。**30箇所前後**で同種のパターンが見つかっている（詳細はこのセッションの調査結果、次回参照時は再監査推奨）。今回はユーザー判断で上位3件のみ着手・修正:

1. **商談カンバンのドラッグ＆ドロップ（`KanbanBoard.tsx`）**: `updateDealStage`に件数確認追加、失敗時のロールバック追加（`TaskKanbanBoard.tsx`には既にあった対応が商談版だけ未実装だった）。`/code-review`で「ロールバックが後発の別ドラッグの結果を上書きしうる」競合を指摘され、現在の状態を確認してから戻すガードを追加。
2. **`DealModal`の失注/復活**: `updateDealStage`強化の副作用でRLS拒否時に偽の成功が出なくなった。対象が既に削除済みの場合は`DealAlreadyDeletedError`で区別し削除処理と同じ後始末をするよう統一。
3. **顧客の一括削除**: `deleteContact`/`deleteContacts`に件数確認追加。`deleteContacts`は`/code-review`指摘を受け「チャンク単位で例外を投げず常に`{deletedIds, failedIds}`を返す」設計に変更（後続チャンク失敗で先行チャンクの成功分がUIに残る幽霊を防止）。**`contacts_delete`RLSが事業部を問わずmanager/super_adminなら削除可能だった不具合も発見・修正**（041、`deals_delete`と同じ権限モデルに統一。**2026-08-21本番SQL適用済み**）。

**未着手の残り（優先度中〜低、次回以降の対応候補）**:
- `activities.ts`の`updateActivityStatus`/`updateActivityFields`（タスク完了トグル・インライン編集全箇所が使用、件数確認なし）
- `contacts/[id]/page.tsx`・`tasks/page.tsx`のインライン編集保存（楽観更新後、失敗時のロールバックなし）
- 設定画面（`settings/page.tsx`）の各種マスタCRUD（資料カテゴリ・商品・カスタム項目・ナレッジカテゴリ・Slack通知設定等）の決め打ちエラーメッセージ
- `deal_payments`/`deal_documents`/`deal_milestones`系の削除関数の件数確認
- `tossups`テーブルにDELETEポリシーが無い（現状`deleteTossup`関数が無く到達不能だが、将来削除機能を足す際は要注意）

## マイグレーション適用状況（2026-08-21確認・訂正）
- **001〜039まで本番適用済み**（038は齋藤香奈さん報告対応で2026-08-20にREST経由で直接データ修正・SQL化して記録）。**036・037も適用済みであることを2026-08-21にservice_roleキーで直接確認・訂正**（`task_meta.sort_order`への小数書き込みがエラーにならない＝NUMERIC化済み、`task_stage_user_visibility`テーブルが実在＝037適用済み。以前「未適用」と記載していたのは古い情報で、`realtime-task-sync`ブランチのmasterマージ（`39b3959`）と同時期に本番SQLも適用されていた）。
- （参考・解消済みの過去の注意点）036は`task_meta.sort_order`をINTEGER→NUMERICに変更する変更で、新フロントコード（fractional indexing）は常に小数値を書き込むため、SQL先行適用が必須だった。036→037の順で適用済み。
- 主要な近年分:
  - 025 タスクカンバン列のDB共有化（`task_kanban_stages` + RPC `replace_task_kanban_stages`）
  - 026 activities_delete ポリシー新設（削除がRLSで無音0行だった不具合）
  - 027/028 activities_select を同一事業部で相互閲覧可に（`shares_division_with` SECURITY DEFINER関数）
  - 029 タスク担当再アサイン（`reassign_task` / `list_division_members`）
  - 030 activities_update・task_meta_select/update を同一事業部メンバーに開放
  - 031 task_meta.sort_order（列内並び替え）
  - 032 user_divisions.show_as_task_assignee（super_adminのタスク看板担当候補opt-in）
  - 033 task_meta.updated_at + BEFOREトリガ（DBタイムスタンプ再同期用）
  - 034 未担当（user_id IS NULL）タスクのRLS修正（`shares_division_with_activity_target`）
  - 035 `replace_pipeline_stages`（パイプラインステージ保存のトランザクション化）
  - 036 `task_meta.sort_order` INTEGER→NUMERIC化、正規化RPC `normalize_task_kanban_sort_order`、`task_meta`/`task_kanban_stages`のRealtime publication追加（適用済み、上記参照）
  - 037 `task_stage_user_visibility`（個人ビューでの担当外列非表示設定）＋RPC `replace_task_stage_visibility`、Realtime publication追加（適用済み、上記参照）
  - 038 財務支援事業部のステージフラグ・レガシーstage_id修正（REST直接適用）
  - 039 タスクカンバンのタブ切り替え機能
  - 040 deals_delete ポリシー新設
  - 041 contacts_delete の事業部スコープ修正
  - 042 activities_select/update・task_meta_select/update に`shares_division_with_activity_target`のOR分岐追加
  - 043 companies_delete ポリシー新設
  - **044〜046（2026-08-28適用済み）** M&A事業部フェーズ1: `industry_classes`（業種マスタ）＋`companies`列追加（044）、業種マスタのサンプル37区分投入（045）、`company_group_links`（グループ会社紐づけ、046）
  - **047〜048（2026-08-28適用済み）** M&A事業部フェーズ2+3: `deal_buyer_prospects`（買手打診リスト）＋`companies`列追加（047）、`deal_seller_conditions`へのAD契・NDA列追加（048）
  - **049（2026-08-28適用済み）** M&A事業部フェーズ4: `division_counterpart_types`（顧客属性マスタ）＋`activities`列追加（`end_at`・`counterpart_type`）
  - **050（2026-09-03適用済み）** M&A事業部フェーズ5（商談画面の改善7項目）: `deal_milestones.completed_at`（対応済みチェック）、`divisions.deal_term`（事業部ごとの「商談」呼称カスタマイズ）、`deal_seller_conditions.desired_price_thousand_yen`（希望譲渡対価の数値化）。詳細は本ファイル冒頭の各該当セクション参照

## 2026-07-31セッションの変更（要点・PRブランチ`realtime-task-sync`、未マージ・未SQL適用）

財務支援事業部（松木紅さん・齋藤香奈さん）からの要望2件に対応。設計はFable 5に壁打ち、実装はPlanモード承認後に実施、`/code-review`（8観点finder→1-vote verify）で8件CONFIRMED・1件PLAUSIBLE・1件REFUTEDのうち高重要度分をすべて修正済み。

1. **リアルタイム同期**: 手動一括push同期ボタン（`handleSyncAllToDb`、ローカルキャッシュ全体を列ごと連番upsertし直す方式）が「2人が同時に編集すると片方が消える」の直接原因だったため撤去。「更新」（pull専用の再読込）＋「並び順を整理」（DBの現在値のみで正規化するRPC呼び出し）の2ボタンに置換。カード移動もfractional indexing（前後カードのsort_orderの中間値を1行だけ書き込む）に変更し、Realtime購読（`src/hooks/useTaskRealtime.ts`）で他ユーザーの変更を手動リロードなしに反映する。
2. **個人ビューの列絞り込み**: 「個人」選択時に担当者ごとの表示列allowlistを管理者（super_admin/manager）が設定できる機能（`task_stage_user_visibility`）。設定行が無いユーザーはfail-open（全列表示）。設定画面は`isSuperAdmin`ブロックとmanagerブロックの両方に配置（RLSはmanagerも許可しているため、UIもそれに合わせた。旧`TaskStagesPanel`は`isSuperAdmin`のみで、`/code-review`でこの不一致に気づいた）。

**/code-reviewで修正した主な指摘**:
- fractional indexing失敗時のロールバックが「初回ドラッグ（並び順未設定）」のケースで無効化されていた（`newOrder`にフォールバックし実質ロールバックされない）→ `clearTaskOrder`（appStore新設）でキー自体を削除する方式に修正
- 個人ビューの列フィルタが`TaskKanbanBoard`の「列削除時は先頭列にフォールバック」ロジックと衝突し、非表示のはずの列のタスクが可視列に紛れ込んでいた → `tasks/page.tsx`で`TaskKanbanBoard`に渡すtasks自体から該当タスクを除外する`kanbanTasks`を新設
- 「並び順を整理」RPCは`task_meta`行が無い/`kanban_stage_id`がNULLのタスクを対象にできず、旧`handleSyncAllToDb`が兼ねていた「未着地タスクの救済」機能が失われていた → `loadTasks`で該当タスクに限り先頭列を1行だけ追加専用で書き込むバックフィルを追加
- `handleRefresh`が非同期の`onRefresh`をawaitしておらず「更新中」表示が実態と無関係だった → async/await化
- 037がRealtime publicationに追加されているのに`useTaskRealtime`が購読しておらず「即時反映」の約束が未実装だった → 購読を追加
- 設定画面の`TaskStageVisibilityPanel`の排他ロック（`savingUserId`）とチェックボックスのdisabled表示が食い違いサイレント無反応になっていた → 全体ロックに統一
- 同パネルの`Promise.all`が個別エラーハンドリングを持たず、DB未接続時に「メンバーがいません」という誤った文言が出ていた → エラー状態を区別して表示

**既知のリスク（要実機検証、対応は見送り）**: `useTaskRealtime.ts`の`task_meta`購読には事業部フィルタが無い（`task_meta`テーブル自体に`division_id`列が無いため）。Supabase RealtimeがRLSを正しく尊重する設定であれば実害はないはずだが、この前提はSupabaseプロジェクトの設定・プラン次第で変わりうるため、本番適用後に2アカウントで①同事業部の他人のイベントが届く②他事業部のイベントは届かない③未担当タスクのイベントが届く④担当変更直後のイベントが届く、の4ケースを必ず確認すること。

## 2026-07-24セッションの変更（要点）
タスクカンバン同期の連続不具合を根本修正。
1. 列内ドラッグ並び替え追加（`@dnd-kit/sortable` の `arrayMove`。`canReorder=scope==='team'` のときのみ永続化）。
2. 未担当タスクがsuper_admin以外に操作不能だった重大RLSバグを034で修正。
3. 削除済みタスクが列全体の一括upsertを巻き添えにする不具合を修正（`upsertTaskOrders` を `Promise.allSettled` で1行ずつ独立化し `{failedIds}` を返す。呼び出し側は失敗行のみロールバック/報告）。
4. 失敗トーストに `formatErrorDetail`（`lib/utils.ts`）でエラー詳細を表示。
5. DBタイムスタンプ再同期（`hydrateTaskMeta` / `taskMetaUpdatedAt`）。
6. 調査副産物: 同種の「一括書き込みall-or-nothing」バグ2件を修正 — `api/admin/users/route.ts`（user_divisions一括insertエラー未チェック→無所属化。PUTをupsert→不要行削除に変更）／`lib/db/divisions.ts` のパイプラインステージ保存を035 RPCへ委譲。

## 2026-07-27セッションの変更（要点）
財務支援事業部（石川紅さん・齋藤香奈さん、いずれもrole:user）から「かなさんが作った（未担当の）タスクが削除できない」と連日報告。
- 原因: 7/24の`b4df918`でUIの削除ボタン表示条件を`isMyTask || super_admin`にしたが、これはDB側のRLS（`activities_delete`、034）が既に許可している範囲（未担当タスクは`shares_division_with_activity_target`経由で同一事業部メンバーなら誰でも削除可）より厳しかった。未担当タスクには「守るべき担当者」が存在しないため誤操作防止の対象にする理由がない。
- 対応（`TaskKanbanBoard.tsx`、SQL不要・PR #1 draft）: `canDelete`に`task.user_id === null`を追加し、UIをDBの権限モデルに合わせた。
- ついでに: `upsertTaskOrders`が部分失敗の原因を「削除済みの可能性があります」と決め打ちしていた点を直し、実際のエラー詳細（`firstError`）をトーストに出すようにした（次回同種の報告が来た際にRLS拒否 vs 削除済みFK違反を即座に切り分けられるように）。
- **service_roleキーで本番DBを直接確認済み**: 報告にあった「株式会社BOOTH」のタスクは調査時点で既にDBから消えていた（super_adminが削除した可能性）。現存する未担当タスクは全社で5件のみで、いずれも財務事業部の顧客に正しく紐づき、task_metaも正常同期済み——恒久的に失敗する未担当タスクは他に残っていない。「6件/1件保存できませんでした」は複数人が同時にドラッグ・削除していたことによる一時的なキャッシュ不整合の可能性が高い。
- 副次的な発見: `task_kanban_stages`（025）・`task_stage_user_visibility`（037、2026-08-21に同様の欠落を確認）は`GRANT ... TO authenticated`のみで`service_role`へのGRANTが無く、service_roleキーでの直接SELECTが`42501`になる。本番ユーザーには影響しないが、将来service_role経由でこれらのテーブルを触る処理を書くときは要注意。新規テーブルを作るときは`GRANT SELECT ON <table> TO service_role;`も併せて付与すると本番調査が楽になる（039以降で徹底）。

## 2026-08-20セッションの変更（要点）

齋藤香奈さんから「商談かんばんを動かしたら『商談の読み込みに失敗しました』が出て、未分類に11件溜まった」と報告。財務支援事業部（division_id=`00000000-0000-0000-0000-000000000003`）のservice_roleキー直接調査で原因を特定・修正済み（`038_fix_finance_stage_flags_and_orphans.sql`、REST経由で本番実データに直接適用・アプリ側コード変更なし）。

1. **ステージのis_won/is_lostフラグ設定ミス**: 「資料作成中」（先頭ステージ）が誤って`is_won:true`になっており、カードを動かすと紙吹雪が出ていた。本来is_wonであるべき「採択」・is_lostであるべき「不採択」にはフラグが立っていなかった。他事業部（IT・人材）は正常だったため、財務支援事業部固有のデータ不整合（過去のステージ名変更時の手動編集ミスと推測、コード側のバグではない）。
2. **レガシーstage_idの取り残し（26件）**: 過去のステージ再編（リード/初回面談/受注/失注 → 資料作成中/共有中/申請中（審査中）/採択/不採択）で、既存商談のstage_idが新ステージUUIDへ移行されず旧文字列（`リード`/`初回面談`/`受注`/`失注`）のまま残っていた。`失注`はis_lostフラグ不整合のおかげで偶然「失注」列にフォールバック表示されていたため未分類には出ていなかったが、①のフラグを直すとそれも一緒に迷子になるため、①②は同時に修正が必須だった。
3. リード/初回面談→資料作成中（3件）、受注→採択（5件）、失注→不採択（18件）へstage_id再マッピング後、フラグ修正。修正後、全28件の迷子ゼロを確認済み。
4. **教訓**: `KanbanBoard.tsx`の「未分類」セーフティネット・「失注列」の自動フォールバック（`is_lost`を持つステージが1つも無い場合に`id:'失注'`のステージを自動生成する仕様）は、is_won/is_lostフラグの設定ミスを覆い隠す方向に働くことがある（今回、不採択にis_lostが無かったせいで失注stage_idの商談が偶然表示できていた）。事業部のステージ構成に違和感（絵文字🎉の付く位置がおかしい等）があれば、まず`pipeline_stages`テーブルのis_won/is_lostを他事業部と比較して確認するのが早い。
5. **【訂正・本命】「商談の読み込みに失敗しました」はハードリロードしても再現する重大な全事業部バグと判明、修正済み（`30c79c9`）。** `fetchDealsByDivision`/`fetchDealsByContact`（`lib/db/deals.ts`）が`contacts(...)`をbareな埋め込みのまま`referrer_contact:referrer_contact_id(...)`と同一selectに含めており、dealsテーブルからcontactsへのFKが`deals_contact_id_fkey`と`deals_referrer_contact_id_fkey`の2本存在するため、PostgRESTが埋め込み先を一意に決められず`PGRST201 Could not embed because more than one relationship was found`で**全事業部・全ユーザーの商談カンバンが例外で読み込み不能**になっていた。`isMissingReferrerColumn`のフォールバック検知はエラーメッセージに"referrer"の文言が含まれることを前提にしていたが、PGRST201のメッセージ本文にはその文言が無く（`details`配列にのみFK名として出現）フォールバックが機能していなかった。`contacts!deals_contact_id_fkey(...)`と制約名を明示して解消し、`isMissingReferrerColumn`にも`more than one relationship`＋`contacts`のPGRST201パターンを追加（将来同種の埋め込み衝突が起きても紹介者なしの従来selectへ自動フォールバックする安全網）。**教訓: 021マイグレーションで同一テーブルへの2本目のFK（紹介者機能）を足した時点で本来この不具合が入り込んでいたはずで、いつから発症していたか特定できていない。同一ターゲットテーブルへの2本目のFKを追加するときは、既存のbare embedとの組み合わせでPGRST201が出ないか必ずcurlで実クエリを再現確認すること。**

## 残タスク・待ち
- **最優先（新規）**: `realtime-task-sync`ブランチのマージ前に、Supabase SQL Editorで036・037を**この順で**適用する（036を先に適用しないとpush後に全ユーザーのドラッグ操作が壊れる。上記マイグレーション適用状況の注意書き参照）。適用後、2アカウントで①同時ドラッグでの消失が起きないか②他ブラウザの変更がリロードなしで反映されるか③未担当・担当変更直後のタスクのRealtime反映④個人ビューの列絞り込み（設定→表示列設定で担当外列を外し、個人ビューで完全非表示になるか）を実機確認し、松木紅さん・齋藤香奈さんに使用感を確認してもらう。
- **実機確認待ち（新規・優先）**: 石川紅さん・齋藤香奈さんに、未担当タスクの削除・並び替えが直ったか再テストしてもらう（PR #1マージ後）。
- 実機確認: 石川/香奈で「削除→別の人が同期」がエラーにならないか。管理者でステージ保存・ユーザー事業部編集が正常か。
- 齋藤PCで山﨑アカウント→設定→タスクカンバン設定「列構成を全メンバーに共有」を押す（他PCが先に列編集すると齋藤PCのローカル構成が失われるため順番厳守。継続中）。
- レスポンシブUI総点検（依頼済み・未着手）。2026-07-12 UX調査の既知課題の対応方針決定。
- 低優先: `api/admin/users/route.ts` POSTロールバック時の `deleteUser` エラー未チェック（既存パターン・極端な縁）。
- 低優先（既存・本件と無関係）: `TaskKanbanBoard.tsx:83` の`daysLeft`計算がlint上「render中にDate.now()を呼んでいる」と警告される（react-hooks/purity）。動作に実害はないが要対応であれば別途。

## RLS/SECURITY DEFINER の再発しやすい罠（このプロジェクト固有の教訓）
- **NULL三値論理**: `IF NOT (a OR b OR c)` は operand がNULLだと素通りする。roleやuser_id比較がNULLになりうる経路を必ず潰す（`COALESCE(...,FALSE)`・明示的 `IS NOT NULL` ガード）。
- **RETURNS TABLE の列名衝突**: 出力列名（id/role等）と本文の無修飾カラム参照が衝突すると実行時 `42702`。テーブルエイリアスで修飾する。CREATE時は通り実行時のみ失敗する。
- **ポリシー式から他のRLS有効テーブルを参照**すると、その参照にも相手のRLSがかかる。事業部横断の所属判定は必ずSECURITY DEFINER関数（`shares_division_with` / `shares_division_with_activity_target`）に閉じ込める。
- 「Success」表示だけでは関数が動く保証にならない。適用後に一度呼ぶか、フロントでRPCエラーをthrow/toastする。
- 一括書き込み（配列 `.upsert`/`.insert`、delete→insert）は1件の失敗で全体が巻き添えになる。行別化（allSettled）か単一トランザクション（RPC）にする。
- **UI側のガードがRLSより厳しくなっていないか要確認**: RLSを緩めた/増やしたときは「クライアント側の表示条件（ボタンのif等）が新しいRLSに追従しているか」を必ず突き合わせる。RLSだけ直してUIを直し忘れると、DB上は操作可能なのに「できない」という紛らわしい不具合報告になる（本件の実例）。逆にUIだけ緩めてRLSを直し忘れるケースも同様に確認すること。

## 環境変数の復旧（別端末でのセットアップ）

作成すべきファイル: `.env.local`（テンプレートは `.env.local.example`）

**最速の復旧手順**:
1. 端末でVercel CLIにログイン（`vercel login`。端末ごとに必要）
2. `vercel link`（プロジェクト名: **pollock-crm**）
3. `vercel env pull .env.local`

上記でVercelに設定済みの本番/開発環境変数がそのままローカルに落ちてくる。手動で1つずつ設定する場合は下表を参照。

| 変数名 | 用途 | 取得元 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase接続URL | Supabaseダッシュボード → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonキー（クライアント用） | Supabaseダッシュボード → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバー側管理操作用（ユーザー作成/削除、`api/admin/*`、`api/webhooks/division-sync`）※絶対に公開しないこと。現状ローカル `.env.local` には未設定（Vercel本番環境のみに設定されている可能性が高い） | Supabaseダッシュボード → Settings → API → service_role |
| `ANTHROPIC_API_KEY` | 名刺OCR（Claude Vision API、`api/ocr/business-card`） | Anthropic Console（https://console.anthropic.com/） |
| `DIVISION_SYNC_SECRET` | pollock-cupとの事業部(divisions/departments)相互同期Webhook（`api/webhooks/division-sync`）用の共有シークレット | 自己生成の任意文字列（pollock-cup側の同名変数と値を一致させる必要あり。現状 `.env.local.example` ではコメントアウトされておりVercel本番環境のみに設定されている可能性が高い） |
| `CRON_SECRET` | Slack自動通知cron（`api/cron/deadline-alerts`）の認証用シークレット。Vercel Cronが付与する `Authorization: Bearer <値>` と一致させる | 自己生成のランダム文字列（現状 `.env.local.example` ではコメントアウトされておりVercel本番環境のみに設定されている可能性が高い） |

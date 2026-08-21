# pollock-crm 引継ぎメモ（.claude/CLAUDE.md）

> コーディング規約・検証コマンドはリポジトリ直下の `CLAUDE.md`（＋`AGENTS.md`）が正。
> システム全体像は `docs/handover-report.md`、M&A要望24項目は `docs/ma-feedback-progress-report.md` が正。
> 本ファイルは「マイグレーション適用状況・最近の変更・残タスク・デプロイ方法」の引継ぎ用。

## デプロイ
- GitHub `ch14no/pollock-crm-` に push → Vercel が自動デプロイ（本番: https://pollock-crm.vercel.app ）。
- **DBマイグレーションは自動適用されない**。`supabase/migrations/NNN_*.sql` を書いても、Supabaseダッシュボード → SQL Editor に手動で貼って実行する運用。frontendのpushとSQL適用は別手順（コード先行 or SQL先行かは変更内容による）。
- service_roleキーはPostgREST/Auth用でDDL（CREATE POLICY/FUNCTION等）は実行不可。ポリシー/関数変更は必ずSQL Editorでユーザーに実行してもらう。

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
  - **036（未適用）** `task_meta.sort_order` INTEGER→NUMERIC化、正規化RPC `normalize_task_kanban_sort_order`、`task_meta`/`task_kanban_stages`のRealtime publication追加
  - **037（未適用）** `task_stage_user_visibility`（個人ビューでの担当外列非表示設定）＋RPC `replace_task_stage_visibility`、Realtime publication追加

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

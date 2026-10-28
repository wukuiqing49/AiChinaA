# Cloud Data Refresh

The website refresh button dispatches `realtime_refresh.yml`. It gets the current
instrument list from the Worker, fetches real-time quotes, and updates only quote fields;
it does not download R2 history or recalculate technical factors.

`daily_pipeline.yml` runs at 15:35 Beijing time on weekdays. It restores the historical
snapshot from R2, appends the post-close daily K-lines, recalculates the screener and
technical factors, then stores the replacement snapshot in R2. The heatmap remains tied
to this completed full-market snapshot.

Configure these GitHub repository secrets:

- `PUBLISH_URL`: `https://a-share-quant-app.developermantou.workers.dev/api/internal/publish-screener`
- `PUBLISH_SECRET`: the Worker publish secret
- `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: R2 S3 API details
- `REFRESH_CALLBACK_URL`: `https://a-share-quant-app.developermantou.workers.dev/api/internal/data-refresh-callback`
- `REFRESH_CALLBACK_SECRET`: a new random value shared with the Worker

Configure these Worker secrets:

- `ADMIN_USERNAMES`: comma-separated fixed-account usernames allowed to request refreshes
- `GITHUB_ACTIONS_TOKEN`: a fine-grained GitHub token with Actions read/write permission for `wukuiqing49/AiChinaA`
- `REFRESH_CALLBACK_SECRET`: the same callback secret stored in GitHub

Apply all Worker migrations through `0023_versioned_datasets.sql` before deploying the
Worker. Set `GITHUB_WORKFLOW` to `realtime_refresh.yml` in the deployed Worker variables.

The daily workflow checks the trading calendar once, then runs the screener and five
supplemental datasets as independent jobs. Supplemental jobs use a matrix with at most
two concurrent jobs and `fail-fast: false`: a screener failure no longer prevents money
flow, valuation, industry or financial updates. Each dataset reports its own outcome;
cleanup waits for all writers to finish. The workflow retains the daily-refresh lock so
a preserved screener resume cannot overlap a new daily run.

Before collection, each job sends an authenticated `preflight` operation to its own
publish endpoint. It resolves required table columns without modifying current data.
This catches missing migrations and invalid credentials early, but does not prove write
quota availability or guarantee that a later database write will succeed. Deploy the
updated Worker before running the updated workflows; older Workers reject preflight.
You can check manually with `python -m pipeline.jobs.publish_preflight --dataset screener`.

Publication uses the existing immutable run IDs, ten-row chunks and atomic activation.
Transient request retries wait 5, 15 and 30 seconds (50 seconds total, excluding request
time); explicit schema/quota failures do not retry. Progress includes elapsed time every
ten chunks. The screener package remains in R2 and Actions artifacts; supplemental
packages are preserved as separate Actions artifacts before publication.

These changes isolate the existing dataset endpoints. R2-to-Queues background import
and automatic failover to a second storage backend are not enabled by this workflow.

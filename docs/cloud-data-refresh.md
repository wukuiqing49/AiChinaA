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

Apply Worker migrations through `0019_realtime_quote_change.sql` before deploying the
Worker. Set `GITHUB_WORKFLOW` to `realtime_refresh.yml` in the deployed Worker variables.

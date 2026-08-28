# Cloud Data Refresh

The website refresh button dispatches `daily_pipeline.yml`. The same workflow runs at
15:35 Beijing time on weekdays, restores the latest historical snapshot from R2, updates
it, publishes the screener, then stores a replacement snapshot in R2.

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

Apply Worker migration `0006_data_refresh_runs.sql` before deploying the Worker.

"""A-share quant data pipeline."""
from __future__ import annotations

import os
import urllib.request

# Ensure domestic financial API calls bypass any dead/stale system proxies
for _key in (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
):
    os.environ.pop(_key, None)

os.environ["NO_PROXY"] = "*"
urllib.request.getproxies = lambda: {}

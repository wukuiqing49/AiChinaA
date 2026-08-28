from __future__ import annotations
import json, os
from pathlib import Path
from urllib.request import Request, urlopen
payload=json.loads(Path("data/realtime/financials.json").read_text(encoding="utf-8"))
url=os.environ.get("PUBLISH_URL", "").replace("/publish-screener","/publish-financials")
request=Request(url,data=json.dumps(payload,ensure_ascii=False).encode(),headers={"Content-Type":"application/json","X-Publish-Secret":os.environ.get("PUBLISH_SECRET","")},method="POST")
with urlopen(request,timeout=90) as response: print(response.read().decode())

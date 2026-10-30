"""Bounded, page-local retries for Eastmoney snapshot endpoint failures."""
from __future__ import annotations

import logging
from time import sleep

import pandas as pd
import requests

HOSTS = ("push2.eastmoney.com", "82.push2.eastmoney.com", "push2delay.eastmoney.com")


def fetch_snapshot(columns: dict[str, str], *, fund_flow: bool = False) -> pd.DataFrame:
    params = {
        "pn": 1, "pz": 100, "po": 1, "np": 1, "fltt": 2, "invt": 2,
        "fid": "f12", "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fs": "m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048",
        "fields": ",".join(columns),
    }
    if fund_flow:
        params["fs"] = (
            "m:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,"
            "m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2"
        )
    rows: list[dict] = []
    expected_total = None
    with requests.Session() as session:
        session.headers.update({"Referer": "https://quote.eastmoney.com/"})
        while True:
            failures = []
            for attempt in range(2):
                for host in HOSTS:
                    try:
                        response = session.get(
                            f"https://{host}/api/qt/clist/get", params=params, timeout=(5, 20)
                        )
                        response.raise_for_status()
                        data = response.json()["data"]
                        total = int(data["total"])
                        page = data["diff"]
                        if isinstance(page, dict):
                            page = list(page.values())
                        if not 0 < total <= 10000 or not isinstance(page, list) or not page:
                            raise ValueError("empty snapshot page")
                        if len(page) > params["pz"]:
                            raise ValueError("snapshot page exceeds requested size")
                        if any(not set(columns).issubset(row) for row in page):
                            raise ValueError("snapshot fields missing")
                        if expected_total is not None and total != expected_total:
                            raise ValueError("snapshot total changed during pagination")
                        break
                    except (requests.RequestException, ValueError, KeyError, TypeError) as error:
                        failures.append(f"{host}: {type(error).__name__}: {error}")
                        logging.warning("Snapshot page %s: %s", params["pn"], failures[-1])
                else:
                    if attempt == 0:
                        sleep(2)
                    continue
                break
            else:
                raise RuntimeError("Eastmoney snapshot unavailable: " + " | ".join(failures))
            expected_total = total
            rows.extend(page)
            if len(rows) >= total:
                break
            params["pn"] += 1
            sleep(0.2)
    frame = pd.DataFrame(rows).rename(columns=columns)
    if len(frame) != expected_total or frame["代码"].duplicated().any():
        raise ValueError("incomplete or duplicated Eastmoney snapshot")
    return frame

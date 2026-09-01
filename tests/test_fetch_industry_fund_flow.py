from __future__ import annotations

import pandas as pd

from pipeline.jobs.fetch_industry_fund_flow import normalize


def test_normalize_industry_fund_flow_converts_yi_to_cny() -> None:
    frame = pd.DataFrame(
        {
            "\u884c\u4e1a": ["\u793a\u4f8b\u884c\u4e1a"],
            "\u6d41\u5165\u8d44\u91d1": [12.5],
            "\u6d41\u51fa\u8d44\u91d1": [10.0],
            "\u51c0\u989d": [2.5],
            "\u516c\u53f8\u5bb6\u6570": [18],
            "\u884c\u4e1a-\u6da8\u8dcc\u5e45": [1.2],
        }
    )

    assert normalize(frame) == [
        {
            "industry": "\u793a\u4f8b\u884c\u4e1a",
            "inflowAmount": 1.25e9,
            "outflowAmount": 1e9,
            "netInflow": 2.5e8,
            "companyCount": 18,
            "pctChange": 1.2,
        }
    ]

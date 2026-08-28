from pipeline.jobs.fetch_realtime_quotes import parse_tencent_response


def _line(symbol: str, code: str, close: str, previous: str, timestamp: str) -> str:
    fields = [""] * 31
    fields[2] = code
    fields[3] = close
    fields[4] = previous
    fields[30] = timestamp
    return f'v_{symbol}="{"~".join(fields)}";'


def test_parse_tencent_response_keeps_stock_and_index_keys_separate() -> None:
    body = "\n".join(
        [
            _line("sz000001", "000001", "12.50", "12.00", "20260828145959"),
            _line("sh000001", "000001", "3900.00", "3880.00", "20260828150001"),
        ]
    )
    targets = {
        "sz000001": ("stock:000001", "000001", "stock"),
        "sh000001": ("index:sh000001", "sh000001", "index"),
    }

    quotes = parse_tencent_response(body, targets)

    assert quotes["stock:000001"]["close"] == 12.5
    assert quotes["index:sh000001"]["close"] == 3900
    assert quotes["stock:000001"]["quoteDate"] == "2026-08-28"
    assert quotes["stock:000001"]["quoteTime"] == "14:59:59"


def test_parse_sina_response_normalizes_backup_source() -> None:
    from pipeline.jobs.fetch_realtime_quotes import parse_sina_response

    fields = [""] * 32
    fields[2] = "12.00"
    fields[3] = "12.50"
    fields[30] = "2026-08-28"
    fields[31] = "15:00:00"
    body = f'hq_str_sz000001="{",".join(fields)}";'

    quotes = parse_sina_response(
        body, {"sz000001": ("stock:000001", "000001", "stock")}
    )

    assert quotes["stock:000001"]["close"] == 12.5
    assert quotes["stock:000001"]["quoteSource"] == "sina"

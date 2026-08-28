@echo off
chcp 65001 > nul
echo ===================================================
echo [A股量化分析工作台] 开始每日收盘全自动增量更新流程
echo ===================================================

echo.
echo [1/3] 正在增量拉取今日最新日K线并追加到历史Parquet数据库...
.venv\Scripts\python.exe -m pipeline.jobs.download_history --incremental --workers 1

echo.
echo [2/3] 正在执行多因子量化计算并生成选股大盘与Top10推荐...
.venv\Scripts\python.exe -m pipeline.jobs.build_screener

echo.
if "%PUBLISH_URL%"=="" (
  echo [3/3] PUBLISH_URL is not set; publish skipped.
) else if "%PUBLISH_SECRET%"=="" (
  echo [3/3] PUBLISH_SECRET is not set; publish skipped.
) else (
  echo [3/3] Publishing the latest screener and market indices...
  .venv\Scripts\python.exe -m pipeline.jobs.publish_screener --input reports\screener-publish.json
)

echo.
echo ===================================================
echo 每日更新已全部完成！数据已无缝合并入历史数据湖。
echo ===================================================
pause

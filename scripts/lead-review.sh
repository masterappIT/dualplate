#!/bin/sh
# 負責人驗收工具（Codex 不得修改本檔）。
# 用法：
#   scripts/lead-review.sh snapshot <輪次>   派工前記錄受保護檔案、測試數量
#   scripts/lead-review.sh verify <輪次>     收工後比對越界改動、刪減測試，並跑全部測試與編譯
set -u
cd "$(dirname "$0")/.." || exit 1
mode=${1:-}; round=${2:-}
[ -n "$mode" ] && [ -n "$round" ] || { echo "用法：$0 snapshot|verify <輪次>"; exit 2; }
dir=.review/$round
protected="mobile admin/src/components/ApprovalCard.vue api/src/customer-routes.js api/test/fixtures scripts/lead-review.sh scripts/shot-service.mjs AGENTS.md docs"

hash_protected() { for p in $protected; do [ -e "$p" ] && find "$p" -type f -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/unpackage/*' -print0 | xargs -0 shasum; done | sort -k2; }
count_tests() { grep -rhoE "^\s*(test|it)\(" api/test admin/scripts 2>/dev/null | wc -l | tr -d ' '; }
count_asserts() { grep -rhoE "assert\.[a-zA-Z]+\(" api/test 2>/dev/null | wc -l | tr -d ' '; }

if [ "$mode" = snapshot ]; then
  mkdir -p "$dir"
  hash_protected > "$dir/protected.sha"
  count_tests > "$dir/tests.count"; count_asserts > "$dir/asserts.count"
  git diff --stat > "$dir/diff-before.txt"
  echo "已記錄第 $round 輪基線：測試 $(cat "$dir/tests.count") 個、斷言 $(cat "$dir/asserts.count") 個"
  exit 0
fi

[ -d "$dir" ] || { echo "沒有第 $round 輪基線，請先 snapshot"; exit 2; }
fail=0
echo "== 受保護檔案（任務明確允許的改動須逐行核對）"
hash_protected > "$dir/protected.after"
if ! diff -q "$dir/protected.sha" "$dir/protected.after" >/dev/null; then diff "$dir/protected.sha" "$dir/protected.after" | grep '^[<>]' | awk '{print $1, $3}' | sort -u -k2; fail=1; else echo "無改動"; fi
echo "== 測試數量"
bt=$(cat "$dir/tests.count"); at=$(count_tests); ba=$(cat "$dir/asserts.count"); aa=$(count_asserts)
echo "測試 $bt → $at；斷言 $ba → $aa"
[ "$at" -lt "$bt" ] || [ "$aa" -lt "$ba" ] && { echo "⚠️ 測試或斷言減少，須查明"; fail=1; }
echo "== 現有測試被刪改的行"
git diff -U0 -- api/test | grep -E '^-[^-]' | grep -vE '^-\s*$' | head -40
echo "== 可疑硬寫（人名、特定車牌、只為測試的分支）"
git diff -U0 -- api/src admin/src | grep -E '^\+' | grep -nE "NODE_ENV *=+ *['\"]test|process\.env\.(TEST|CI)|黃志強|李先生|大明有限|样本|粵Z[0-9A-Z]{4}" | head -20
echo "== 樣式規則與模板引用"
(cd admin && npm run -s check) || fail=1
echo "== API 測試"
(cd api && npm test 2>&1 | grep -E '^ℹ (tests|pass|fail|cancelled)') ; (cd api && npm test >/dev/null 2>&1) || fail=1
echo "== 編譯"
(cd admin && npm run -s build >/dev/null 2>&1 && echo "admin build 通過") || { echo "admin build 失敗"; fail=1; }
(cd mobile && npm run -s build:h5 >/dev/null 2>&1 && echo "mobile build 通過") || { echo "mobile build 失敗"; fail=1; }
[ $fail = 0 ] && echo "自動檢查通過（仍須人工逐行審查與瀏覽器實測）" || echo "自動檢查有問題，見上"
exit $fail

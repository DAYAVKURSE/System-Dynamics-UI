# Вливает партию переводов в locales/en.json и locales/zh.json.
# Использование: python3 scripts/i18n-put.py < batch.json, где batch —
# {"русский ключ": ["english", "中文"], ...}. Пустая строка — перевода нет.
import json, sys
batch = json.load(sys.stdin)
for i, lang in enumerate(["en", "zh"]):
    p = f"locales/{lang}.json"
    d = json.load(open(p, encoding="utf-8"))
    n = 0
    for k, v in batch.items():
        if k not in d:
            print("нет такого ключа:", repr(k)[:80], file=sys.stderr); continue
        if v[i]:
            d[k] = v[i]; n += 1
    json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    empty = sum(1 for v in d.values() if not v)
    print(f"{lang}: записано {n}, без перевода {empty}")

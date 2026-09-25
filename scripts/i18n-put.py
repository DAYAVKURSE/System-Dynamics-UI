# Вливает партию переводов в файлы языков locales/*.json (файл — язык).
# Использование: python3 scripts/i18n-put.py < batch.json, где batch —
# {"русский ключ": {"English": "…", "中文": "…"}, ...} либо
# {"русский ключ": ["…", "…"]} — списком в алфавитном порядке файлов.
# Пустая строка — перевода нет.
import json, os, sys
batch = json.load(sys.stdin)
langs = sorted(f[:-5] for f in os.listdir("locales") if f.endswith(".json"))
for i, lang in enumerate(langs):
    p = f"locales/{lang}.json"
    d = json.load(open(p, encoding="utf-8"))
    n = 0
    for k, v in batch.items():
        if k not in d:
            print("нет такого ключа:", repr(k)[:80], file=sys.stderr); continue
        val = v.get(lang, "") if isinstance(v, dict) else (v[i] if i < len(v) else "")
        if val:
            d[k] = val; n += 1
    json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    empty = sum(1 for v in d.values() if not v)
    print(f"{lang}: записано {n}, без перевода {empty}")

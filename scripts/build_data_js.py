# Gera data/data.js embarcando todos os JSONs como objeto JavaScript global.
# Necessário porque o navegador (Chrome em particular) bloqueia fetch() de arquivos
# locais com file:// por CORS. Embarcando como <script>, abre por duplo-clique sem servidor.
#
# Rodar sempre que algum JSON em data/ mudar:
#   python scripts/build_data_js.py

import json
from pathlib import Path

DATA = Path(__file__).parent.parent / "data"
OUT = DATA / "data.js"

bundle = {
    "teams": json.loads((DATA / "teams.json").read_text(encoding="utf-8")),
    "matches": json.loads((DATA / "matches.json").read_text(encoding="utf-8")),
    "bracket": json.loads((DATA / "bracket.json").read_text(encoding="utf-8")),
    "thirdTable": json.loads((DATA / "third_place_table.json").read_text(encoding="utf-8")),
}

js = "// Gerado por scripts/build_data_js.py — não editar manualmente.\n"
js += "window.APP_DATA = " + json.dumps(bundle, ensure_ascii=False) + ";\n"

OUT.write_text(js, encoding="utf-8")
print(f"OK: {OUT} ({OUT.stat().st_size:,} bytes)")

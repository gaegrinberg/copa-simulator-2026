# Parseia a tabela das 495 combinações da Wikipedia (wikitext) e gera data/third_place_table.json
# Uso: python scripts/parse_third_table.py

import json
import re
from pathlib import Path

RAW = Path(__file__).parent / "_thirdtable_raw.txt"
OUT = Path(__file__).parent.parent / "data" / "third_place_table.json"

# Ordem das colunas de slots no header da Wikipedia:
# 1A vs, 1B vs, 1D vs, 1E vs, 1G vs, 1I vs, 1K vs, 1L vs
# Mapeamento para os matchIds do nosso bracket.json:
SLOT_ORDER = ["1A", "1B", "1D", "1E", "1G", "1I", "1K", "1L"]
SLOT_TO_MATCH = {
    "1A": "M079",
    "1B": "M085",
    "1D": "M081",
    "1E": "M074",
    "1G": "M082",
    "1I": "M077",
    "1K": "M087",
    "1L": "M080",
}

GROUPS = "ABCDEFGHIJKL"

raw = RAW.read_text(encoding="utf-8")

# Cada entrada começa com ! scope="row" | <N>
# Padrão da linha de dados:
#   ! scope="row" | 1
#   | || || || || '''E''' || '''F''' || ... || '''L''' || ... || {{No}} || 3E || 3J || ... || 3K

entries = []
# Split em blocos por "! scope=\"row\""
blocks = re.split(r'! scope="row" \| (\d+)\s*\n', raw)
# blocks[0] = before first row; blocks[1]=number 1; blocks[2]=content of row 1; etc.
for i in range(1, len(blocks), 2):
    number = int(blocks[i])
    content = blocks[i + 1]
    # A "data row" pode ter cells em múltiplas linhas (linha 1 tem rowspans).
    # Junto todas as linhas até o próximo `|-` (separador de linha) ou fim do bloco.
    # Conteúdo do bloco vai até o próximo `! scope="row"` (split já fez isso).
    # Removo `|-` que indica linhas seguintes (não deveria acontecer dentro do bloco mas seguro).
    joined = " ".join(content.split("\n"))
    # Achato múltiplos pipes em || consistente: cada cell começa com `| ` ou `||`.
    # Substituo `! rowspan="495" |` e similares (não-data) por nada
    joined = re.sub(r'! rowspan="\d+" \|', '', joined)
    # Remove linhas vazias / espaços iniciais excessivos
    # Agora divide nas barras duplas e simples (cells separadas por || ou | no início)
    # Caso simples: cells separadas por ||. Cell inicial após `|`. Vou normalizar:
    joined = joined.lstrip().lstrip("|")
    # Substituo `| ` (separador alternativo) por `||` para uniformizar
    joined = re.sub(r'(?<!\|)\|(?!\|)', '||', joined)
    cells_raw = joined.split("||")
    # Strip e limpa cada cell
    cells = [c.strip() for c in cells_raw]
    # Algumas linhas tem `! rowspan="495" |` celulas separadoras vazias — filtrar
    # Padrão observado: 12 group cells + 1 status + 8 assignment cells
    # Mas a linha 1 tem celulas extras vazias (separadores). Vamos achar o índice do status.
    # Status é "{{No}}" ou "{{Yes}}" ou "No"/"Yes"
    status_idx = None
    for idx, c in enumerate(cells):
        if c in ("{{No}}", "{{Yes}}", "No", "Yes"):
            status_idx = idx
            break
    if status_idx is None:
        print(f"AVISO row {number}: não achei status. Cells: {cells[:5]}...")
        continue
    # As 12 cells de grupos são as PRIMEIRAS 12 cells (ignorando celulas vazias entre os 12 e o status, se houver)
    group_cells = cells[:12]
    status = "Yes" if "Yes" in cells[status_idx] else "No"
    # Assignments: as 8 cells após o status (pulando eventuais separadores rowspan)
    after_status = cells[status_idx + 1:]
    assignments = [c for c in after_status if re.match(r"^3[A-L]$", c)][:8]
    if len(assignments) != 8:
        print(f"AVISO row {number}: achei {len(assignments)} assignments em vez de 8")
        continue
    # Extrair quais grupos estão avançando
    advancing = []
    for idx, g in enumerate(GROUPS):
        c = group_cells[idx] if idx < len(group_cells) else ""
        # Cell tem '''X''' se grupo X avança
        if f"'''{g}'''" in c:
            advancing.append(g)
    if len(advancing) != 8:
        print(f"AVISO row {number}: {len(advancing)} grupos avançando em vez de 8. Cells: {group_cells}")
        continue
    # Construir mapa
    slot_to_third_group = {}
    for slot, asn in zip(SLOT_ORDER, assignments):
        slot_to_third_group[SLOT_TO_MATCH[slot]] = asn[1]  # 3X → X
    entries.append({
        "n": number,
        "advancing": "".join(sorted(advancing)),
        "still_possible": status == "Yes",
        "mapping": slot_to_third_group,
    })

print(f"Total entradas parseadas: {len(entries)}")
print(f"  Ainda possíveis: {sum(1 for e in entries if e['still_possible'])}")
print(f"  Eliminadas:      {sum(1 for e in entries if not e['still_possible'])}")

# Indexar por combinação (string ordenada de 8 letras)
by_combo = {}
for e in entries:
    by_combo[e["advancing"]] = {
        "n": e["n"],
        "still_possible": e["still_possible"],
        "mapping": e["mapping"],
    }

print(f"Combinações únicas: {len(by_combo)}")
assert len(by_combo) == 495, f"Esperado 495 combinações, achei {len(by_combo)}"

# Salvar
result = {
    "meta": {
        "source": "Wikipedia Template:2026_FIFA_World_Cup_third-place_table (raw wikitext)",
        "description": "Mapeamento canônico FIFA das 495 combinações C(12,8) → assignment dos 3ºs colocados aos 8 slots do R32. Para cada combinação (string com os 8 grupos que enviam 3º colocado, ordenados alfabeticamente), a entrada 'mapping' mapeia matchId do R32 → grupo origem do 3º.",
        "slot_match_ids": SLOT_TO_MATCH,
        "total_combinations": len(by_combo),
        "still_possible_at_snapshot": sum(1 for e in by_combo.values() if e["still_possible"]),
    },
    "combinations": by_combo,
}
OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"\nSalvo em: {OUT}")
print(f"Tamanho: {OUT.stat().st_size:,} bytes")

# Validação extra: para cada combinação, mapping deve usar exatamente os 8 grupos avançando
errors = 0
for combo, e in by_combo.items():
    used = set(e["mapping"].values())
    expected = set(combo)
    if used != expected:
        print(f"  Erro combo {combo}: mapping usa {used}, esperado {expected}")
        errors += 1
print(f"\nValidação: {errors} erros")

# Exemplo: imprimir combinação atual (top-8 conforme test_tournament.js)
print("\nExemplo — combo BCDFHJLA (top 8 atual nos dados de 25/06):")
# Estado atual top 8: B, F, L, A, J, D, C, H = ABCDFHJL
sample = "ABCDFHJL"
if sample in by_combo:
    print(f"  Mapping: {by_combo[sample]['mapping']}")
    print(f"  Still possible: {by_combo[sample]['still_possible']}")
else:
    print(f"  Combo {sample} não encontrada.")

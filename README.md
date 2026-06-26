# Simulador Copa do Mundo 2026

Simulador Monte Carlo offline da Copa do Mundo 2026 (48 seleções, 12 grupos, formato FIFA novo). Pure HTML+JS, sem build, sem servidor.

## Como abrir

Por causa de CORS para `file://`, é melhor rodar um servidor estático local. Há um config de preview pronto (`.claude/launch.json`); se quiser por fora:

```bash
python -m http.server 8765
```

Depois abrir `http://localhost:8765/`.

Alternativa: pode abrir `index.html` diretamente — todos os dados estão pré-bundleados em `data/data.js`.

## Modelo

- **Força das seleções**: Elo do [eloratings.net](https://eloratings.net) (snapshot 25/06/2026).
- **Gols esperados**: Dixon-Coles (Poisson bivariado com correção τ para placares baixos), λ derivado da diferença de Elo + vantagem de mando para anfitriões (USA/CAN/MEX) na fase de grupos.
- **Mata-mata**: 90' → prorrogação (λ×30/90) → pênaltis com probabilidade de conversão modulada por Elo.
- **Elo update jogo a jogo dentro de cada simulação**: K=60, fator G de saldo de gols. Se um time inferior vence numa simulação, ele leva esse boost para o próximo confronto da mesma trajetória.
- **Formato 48 times**: 12 grupos × 4 → 1º + 2º + 8 melhores 3ºs (tabela FIFA das 495 combinações C(12,8) implementada de forma canônica) → R32 → R16 → Quartas → Semis → 3º lugar + Final.

## Abas

| Aba | O que mostra |
|---|---|
| **Visão geral** | Tabela das 48 seleções ordenada por P(título), com prob de cada estágio (avançar → R16 → quartas → semis → final → título). |
| **Fase de grupos** | 12 cards (um por grupo) com tabela ao vivo (jogos disputados + simulados como projeção) e barra empilhada de P(1º/2º/3º/4º). |
| **Mata-mata** | Bracket visual em árvore SVG mostrando candidatos mais prováveis em cada confronto e vencedor projetado. |
| **Por seleção** | Detalhe de um time: Elo, jogos da fase de grupos, caminho até a final, posição final no grupo. |
| **Simulação manual** | Fixa placares hipotéticos de jogos futuros e re-roda Monte Carlo. Todas as outras abas refletem o cenário (com banner indicador). |

## Simulação manual

1. Vai na aba **Simulação manual**, digita placares dos jogos que quer fixar (Elo é atualizado dentro de cada simulação como se o jogo tivesse ocorrido).
2. Clica em **Aplicar cenário e simular**. O Monte Carlo roda só nos jogos não fixados.
3. As outras abas trocam para o modo cenário (banner amarelo no topo). O painel à direita mostra Δ de P(título) e Δ de P(classificação) vs. baseline.
4. **Voltar ao baseline** no banner limpa tudo.

Tecnicamente: usa **common random numbers** (cenário reusa a seed da última baseline) para isolar o efeito causal dos jogos fixados e reduzir variância entre rodadas.

## Performance

- Web Worker para não travar a UI; fallback automático para main thread em chunks se o navegador bloquear o Worker via `file://`.
- Em ~2k sims/segundo numa máquina comum: 10k em ~5s, 100k em ~45s.
- Otimizações: grid Poisson flat reaproveitado entre matches, PMF incremental sem `Math.pow`, correção D-C inline.

## Estrutura

```
copa_simulator/
  index.html              # entrada
  styles.css              # dark mode, acento verde
  data/
    teams.json            # 48 seleções + Elo inicial
    matches.json          # 104 jogos do calendário + resultados reais
    bracket.json          # mapeamento R32→Final + tabela FIFA de 3ºs
    third_place_table.json# 495 combinações canônicas FIFA
    data.js               # bundle das 4 fontes (evita CORS file://)
  js/
    model.js              # Dixon-Coles + Poisson + ET + pens
    elo.js                # update Elo padrão eloratings.net (K=60)
    tournament.js         # regras: grupos, desempates, alocação de 3ºs
    simulator.js          # Monte Carlo (suporta overrides p/ cenário manual)
    worker.js             # Web Worker rodando simulator
    main.js               # bootstrap, abas, dispatcher de modos
    ui/
      overview.js
      groups.js
      bracket.js          # árvore SVG estilo Football Meets Data
      team.js
      manual.js
  scripts/
    build_data_js.py      # gera data/data.js a partir dos JSONs
    test_model.js         # validação do modelo via Node
```

## Validação de sanidade (100k sims, baseline 25/06/2026)

Top picks pelo P(título):

| Pos | Seleção | P(título) |
|---|---|---|
| 1 | Argentina | 16.5% |
| 2 | Espanha | 14.4% |
| 3 | França | 11.5% |
| 4 | Inglaterra | 6.4% |
| 5 | Colômbia | 6.0% |
| 6 | Brasil | 5.3% |
| 7 | Portugal | 5.2% |
| 8 | Holanda | 4.4% |
| 9 | Noruega | 4.2% |
| 10 | Alemanha | 3.9% |

Consistente com casas de aposta no estado atual do torneio (Argentina vencedora da Copa América 2024 + Espanha vencedora da Euro 2024 + França tradicional).

## Notas

- Vantagem de mando: aplicada quando o anfitrião (USA/CAN/MEX) figura como `home` no `matches.json`. Alguns jogos em sedes anfitriãs em que o anfitrião está como `away` não recebem boost — limitação aceita para não complicar o modelo.
- Atalhos de teclado: setas ←/→ navegam entre abas. `Tab` entre os placares na simulação manual.
- Compatibilidade: testado em Chrome. Funciona em qualquer browser moderno com Web Workers.

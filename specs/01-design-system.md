# 01 — Design system (estilo Untitled UI, claro e minimalista)

Tema **claro apenas**. Muita respiração (whitespace), hierarquia por peso/tamanho de texto e hairlines, não por caixas coloridas. Nada de emojis; ícones lucide-react com `strokeWidth={2}` e 20 px (16 px em contextos densos).

## Tokens (definir como CSS custom properties em `globals.css` e mapear no Tailwind v4 via `@theme`)

Superfícies e tinta (paleta neutra quente, validada):

| Token | Valor | Uso |
|---|---|---|
| `--bg-page` | `#f9f9f7` | fundo da página |
| `--bg-surface` | `#ffffff` | cards, sheets, inputs |
| `--bg-subtle` | `#f3f3f0` | hovers, wash de seleção, skeletons |
| `--ink-primary` | `#0b0b0b` | títulos, valores, botão primário |
| `--ink-secondary` | `#52514e` | texto de apoio |
| `--ink-muted` | `#898781` | labels, metadados, placeholders |
| `--hairline` | `#e1e0d9` | divisores, bordas de card |
| `--border-ring` | `rgba(11,11,11,0.10)` | anel de borda de inputs/cards |
| `--accent` | `#2a78d6` | links, foco, seleção, elementos interativos |
| `--accent-subtle` | `#e8f1fb` | wash de item selecionado |

Status (reservados, nunca reutilizar como cor de agenda):

| Papel | Valor | Uso |
|---|---|---|
| `--status-good` | `#0ca30c` | sucesso, "chega a tempo" |
| `--status-warning` | `#fab219` | avisos leves |
| `--status-critical` | `#d03b3b` | tag **Atrasado**, erros, excluir |

Status nunca aparece só por cor: sempre ícone + texto (ex.: tag Atrasado = ícone `clock-alert` + "Atrasado 12 min").

## Cores de agenda (paleta categórica fixa, ordem obrigatória)

Exatamente estas 8 opções no seletor de cor, nesta ordem (ordem maximiza distinção para daltonismo — não reordenar, não gerar outros tons):

1. Azul `#2a78d6` · 2. Verde-água `#1baf7a` · 3. Amarelo `#eda100` · 4. Verde `#008300` · 5. Violeta `#4a3aa7` · 6. Vermelho `#e34948` · 7. Magenta `#e87ba4` · 8. Laranja `#eb6834`

No calendário, o evento usa a cor da agenda como barra/pill; texto do evento sempre em tinta (`--ink-primary`/`--ink-secondary`), nunca na cor da série. Em fundos coloridos (pill do mês), usar wash da cor a 12% + dot sólido + texto em tinta.

## Tipografia

Inter via `next/font/google` (`--font-sans`), fallback system-ui. Escala: 12/13/14 (base)/16/18/24/30. Títulos de página 24 semibold; títulos de card 16 semibold; corpo 14; metadados 13 `--ink-muted`. Números grandes dos stat tiles: 30 semibold, figuras proporcionais (não usar `tabular-nums` em número standalone).

## Componentes base (`src/components/ui/`)

Todos com API mínima e consistente (`className` mesclável; usar util `cn()` em `src/lib/cn.ts`):

- **Button**: variantes `primary` (fundo `--ink-primary`, texto branco), `secondary` (borda hairline, fundo surface), `ghost`, `destructive` (texto/borda critical). Altura 40 px (44 px em telas touch), radius 8 px, press: `active:scale-[0.98]`.
- **Input / Textarea / Select**: altura 40 px, radius 8 px, borda `--border-ring`, foco: anel 2px `--accent` (via `focus-visible`), label 13 medium acima, erro em `--status-critical` 13.
- **Card**: surface, radius 12 px, borda hairline, sem sombra por padrão (sombra `0 1px 2px rgba(11,11,11,.05)` opcional).
- **Sheet** (bottom sheet mobile / painel lateral ≥768 px): overlay `rgba(11,11,11,.4)`, slide-up 200 ms ease-out, handle superior, fecha por swipe/overlay/X.
- **Dialog** (confirmações): fade+scale 150 ms.
- **Badge/Tag**: radius full, 12 medium, wash 12% da cor + texto em tinta.
- **Switch**, **SegmentedControl** (para Hoje/Semana/Mês), **Skeleton**, **EmptyState** (ícone + frase + ação), **Toast** (canto inferior, 3 s).
- **ColorPicker** de agenda: 8 swatches redondos 28 px na ordem fixa, selecionado com anel `--accent`.

## Stat tile (dashboard)

Contrato: `label` (13 `--ink-muted`, sentence case, sem dois-pontos) + `value` (30 semibold `--ink-primary`). Card clicável (hoje → calendário em Hoje; semana → Semana; solicitações → `/solicitacoes`). Solicitações com valor > 0 ganham dot `--accent` ao lado do label. Grid: 3 colunas compactas no mobile (valores podem reduzir p/ 24), gap 8–12 px.

## Layout e navegação

- Mobile (<768 px): header fixo simples (título da rota + avatar), conteúdo com `padding: 16px`, **bottom nav** fixa com 4 itens (Início, Agendas, Perfil, Ajustes), ícones 24 px + label 11, item ativo em `--accent`; safe-area (`env(safe-area-inset-bottom)`).
- Desktop (≥768 px): sidebar 240 px à esquerda, mesmo menu, conteúdo max-w 1040 px centralizado.
- FAB "+" (novo evento) no dashboard mobile, 56 px, fundo `--ink-primary`, acima da bottom nav.

## Animações

Sutis e rápidas: 150–200 ms, `ease-out`, apenas opacity/transform. Entrada de páginas: fade 150 ms. Listas: sem stagger exagerado (máx. 40 ms entre itens, só no primeiro load). Sempre respeitar `prefers-reduced-motion: reduce` (desliga transforms). Nunca animar layout via propriedades caras (top/left/height) — usar transform.

## PWA

`manifest.webmanifest`: name "Agenda", display standalone, `background_color #f9f9f7`, `theme_color #f9f9f7`, ícones 192/512 (gerar PNG simples: glifo de calendário traço preto em fundo branco, cantos arredondados). SW mínimo (`public/sw.js`): cache-first para assets estáticos, network-first para páginas; registrar num client component no layout raiz.

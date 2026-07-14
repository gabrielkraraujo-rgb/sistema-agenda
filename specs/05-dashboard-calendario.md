# 05 — Dashboard e calendário (página `/`)

Página única, de cima para baixo (mobile-first):

1. **Stat tiles** (3, grid compacto): "Eventos hoje", "Nesta semana", "Solicitações" — contrato em specs/01. Dados de `getDashboardStats()`.
2. **Próximos eventos**: título de seção "Próximos eventos" (16 semibold) + até 3 `EventCard` de `getUpcomingEvents(3)`. EmptyState discreto se vazio.
3. **Calendário**: SegmentedControl **Hoje / Semana / Mês** + navegação (‹ hoje ›) + FullCalendar (versão compacta — mesmos slots reduzidos da página `/calendario`).
4. **FAB "+"** (mobile) e botão "Novo evento" no header (desktop) → sheet de criação.

## EventCard

No máximo **3 linhas**, mesmo com atraso: barra vertical 3 px na cor da agenda · título 14 medium · horário 13 muted ("14:00 – 15:30" ou "Dia inteiro") · **uma única linha de local** (só existe quando há `location` — `travel` nunca aparece sem local): ícone `map-pin` 13 muted + local truncado (`min-w-0`/`truncate`) e, quando houver `travel`, a distância logo depois do local (separador "·", ex.: "Barueri, SP, Brasil · 690 km") — tudo dentro do trecho truncável. Ao final dessa mesma linha, sem quebrar (`shrink-0`, `whitespace-nowrap`):
- se `travel.lateByMin` existir: tag crítica ícone `clock-alert` + "Atrasado {n} min" (`--status-critical`);
- senão: ícone `car` + "{durationMin} min".

Clique abre sheet de detalhe.

## Página `/calendario`

Calendário em tela cheia (`src/app/(app)/calendario/page.tsx` + `src/components/calendario-client.tsx`), sem stat tiles nem "Próximos eventos" — só o `CalendarView` ocupando toda a altura útil.

- Desktop: sidebar padrão à esquerda + cabeçalho de página próprio ("Calendário" + botão "Novo evento") + calendário preenchendo o restante da altura (`height: "100%"` no FullCalendar, container com altura definida via flex, descontando o padding vertical do `<main>`).
- Mobile: header fixo (título "Calendário" via `AppNav`) + calendário preenchendo o meio + bottom nav; FAB "+" para novo evento.
- Toolbar própria (SegmentedControl Hoje/Semana/Mês + setas + hoje) — a mesma UI embutida no `CalendarView`, reaproveitada via prop `storageKey` para persistir a view em uma chave de `localStorage` **separada** da usada no dashboard. View inicial: Semana no desktop, Hoje no mobile (igual ao dashboard).
- Orquestração (sheet de detalhe, form de criar/editar, refresh após mutação) compartilhada com o dashboard via hook `useEventOrchestration` (`src/hooks/use-event-orchestration.ts`), evitando duplicar os mesmos estados/handlers em `DashboardClient` e `CalendarioClient`.
- Navegação: item "Calendário" (ícone `calendar`) entre "Início" e "Agendas" na bottom nav (5 itens) e na sidebar desktop.

## FullCalendar (`src/components/calendar-view.tsx`, client component)

- Plugins: `dayGridMonth` (Mês), `timeGridWeek` (Semana), `timeGridDay` (Hoje), `interaction`.
- `locale: ptBR` (`@fullcalendar/core/locales/pt-br`), `timeZone: "America/Sao_Paulo"`, `headerToolbar: false` (toolbar própria com SegmentedControl/setas), semana começando na segunda (`firstDay: 1`), `nowIndicator: true`.
- Componente reutilizável: props `storageKey` (chave de `localStorage` da view — dashboard e `/calendario` usam chaves separadas) e `height`/`className` (`"auto"` no dashboard; `"100%"` + container com altura definida via flex em `/calendario`), além de `onSelectOccurrence`.
- View inicial: **Hoje** (timeGridDay) no mobile, Semana no desktop. Persistir última view em `localStorage` (chave conforme `storageKey`).
- Eventos: buscar `getOccurrences` para a janela visível (`datesSet` → server action; guardar em estado). Mapear OccurrenceDTO → EventInput do FC: `backgroundColor` = wash 12% da cor, `borderColor` transparente, dot/barra na cor sólida, texto em tinta (custom `eventContent` para controlar tipografia; no mês, pill com dot + título 12; nas views Hoje/Semana, o horário só aparece quando a ocorrência dura mais de 45 min — evita cortar texto nos slots reduzidos). `NEEDS_ACTION`: borda tracejada + opacidade 0.7.
- **Drag & drop**: `editable: true`, `eventDrop` e `eventResize` → se `isRecurring`, abrir Dialog "Alterar somente este evento ou todos?" (botões: "Somente este", "Todos", Cancelar) e então `moveEvent({...scope})`; revert() em erro com Toast. Mobile: `longPressDelay: 250`, `eventLongPressDelay: 250`, `dragScroll: true`. Eventos `readOnly` com `editable: false` individual.
- Estilização via CSS custom (arquivo `src/components/calendar-view.css` sobrescrevendo variáveis `--fc-*` e classes): hairlines `--hairline`, labels 12 muted, célula "hoje" wash `--accent-subtle`, remover bordas duplas — visual limpo tipo Untitled UI. Slots do timeGrid (Hoje/Semana) em ~1.375rem (~1.125rem em telas ≤640px) — metade da altura original, para caber mais horas na tela mantendo os labels de hora legíveis.

## Sheet de detalhe do evento

Título + dot/nome da agenda · data/hora por extenso em pt-BR · local (link para Google Maps `https://maps.google.com/?q=`) com badge de viagem/atraso · link de vídeo (botão "Entrar na chamada", `video` icon) · descrição · convidados (lista e-mail + status) · lembrete. Ações: Editar (abre form), Excluir (Dialog; se recorrente, escopo). Convite NEEDS_ACTION: barra superior com Aceitar/Recusar.

## Sheet de criar/editar (`event-form`)

Campos: título · agenda (Select com dots de cor; default `isDefault`) · dia inteiro (Switch) · início/fim (`datetime-local` — ou `date` quando dia inteiro; ao mudar início, manter duração) · repetir (Select: Não repete / Todo dia / Toda semana / Todo mês / Todo ano) · local (Input livre) · link de vídeo · convidados (input e-mail com Enter → chips) · lembrete (Select: Padrão / Sem lembrete / 10 min / 30 min / 1 h / 1 dia) · descrição. Validação inline; submit com loading; Toast de sucesso.

## Comportamento de dados

Após qualquer mutação: recarregar stats, próximos e janela do calendário (um `router.refresh()` + refetch da janela é aceitável). Otimista apenas no DnD (FC já move visualmente; reverter se falhar).

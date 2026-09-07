# План реализации управляемого AI sales-агента Flywheel

> **Этот файл здесь чужой.** Цикл 2 (продажа до готовности) живёт в `/Users/alenakulish/dev/evorove`. Этот репозиторий — только цикл 3: приём горячего лида и запись часа. Не реализовывать sales-разговор, playbook и поиск людей по этому документу.

**Статус:** рабочий план и источник истины для дальнейшей реализации  
**Дата:** 4 сентября 2026 года  
**Проект:** `AleneSparrow/ai-business-process-engine`

## 1. Цель

Построить в Flywheel AI sales-агента, который ведёт входящий лид по полному циклу продажи:

1. приветствует клиента и устанавливает контекст;
2. выявляет проблему, цель, критерии выбора и сроки;
3. презентует только релевантную ценность;
4. диагностирует и отрабатывает возражения;
5. запрашивает небольшое подтверждение следующего шага;
6. предлагает запись, консультацию или обратный звонок;
7. выполняет согласованный follow-up;
8. передаёт разговор человеку при риске, недостатке разрешённых знаний или выходе за политику бизнеса;
9. сохраняет объяснимый аудит каждого решения и измеряет результат.

Система должна общаться естественно и адаптироваться к клиенту, но не позволять языковой модели самостоятельно назначать цену, предоставлять скидку, делать юридические или коммерческие обещания, выбирать недопустимый путь либо менять правила бизнеса.

## 2. Основной архитектурный принцип

Sales-процесс детерминирован. Языковая модель Anthropic остаётся вероятностным компонентом с ограниченной ролью.

Распределение ответственности:

- **Claude анализирует язык:** потребность, возражение, buying signal, тон, явное согласие, просьбу о follow-up и подтверждающие цитаты клиента.
- **Sales Policy Engine принимает решение:** стадия продажи, разрешённый следующий ход, необходимость человека и допустимые инструменты.
- **Sales Knowledge Base предоставляет знания:** только утверждённые методические карточки с источниками и версиями.
- **Business DNA предоставляет факты:** услуги, цены, география, доступность, ограничения, допустимые обещания и стиль бизнеса.
- **Claude формулирует ответ:** использует только выбранный sales move, разрешённые knowledge cards и подтверждённые business facts.
- **Policy Validator проверяет результат:** блокирует неподтверждённые факты, скидки, гарантии, несуществующие действия и другие нарушения.
- **Инструменты выполняют действие:** бронирование, callback, SMS, CRM-задача или handoff.
- **Аудит и аналитика измеряют результат:** сохраняют причины решения и переход клиента к следующему этапу.

Целевой поток одного хода:

```text
Customer message
    → SalesTurnAnalyzer (Claude, structured output)
    → CustomerSalesProfile update (evidence-grounded)
    → Deterministic SalesPolicyEngine
    → Approved SalesMove
    → Approved knowledge cards + Business DNA facts
    → SalesResponseGenerator (Claude)
    → PolicyValidator
    → Message/tool execution
    → Audit event + outcome
    → Follow-up scheduler or next customer trigger
```

## 3. Что не является целью

- Создание или обучение отдельной фундаментальной модели.
- Предоставление Claude права самостоятельно изобретать sales-стратегию.
- Загрузка книг в prompt без структурирования и утверждения знаний.
- Автоматическое изменение production-playbook самой моделью.
- Обещание гарантированной конверсии.
- Сбор оплаты клиента до отдельной реализации безопасного payment flow.
- Голосовой AI-звонок в первом релизе. На первом этапе callback означает назначение времени и/или создание задачи сотруднику.

## 4. SalesStage и ProcessState

Не смешивать стадию разговора со статусом бизнес-обязательств.

- `ProcessState` продолжает описывать состояние исполняемого бизнес-процесса: квалификация, запись, смета, победа, потеря, human review и другие существующие состояния.
- `SalesStage` описывает текущий этап продажи внутри разговора.

Предварительный закрытый перечень `SalesStage`:

```text
GREETING
DISCOVERY
NEEDS_CONFIRMED
PRESENTATION
OBJECTION_HANDLING
COMMITMENT
BOOKING
NURTURE
FOLLOW_UP
WON
LOST
HUMAN_REVIEW
```

Перед реализацией необходимо проверить этот перечень против существующих `ProcessState`, `CommercialWorkflowService` и реальных сценариев. Новые значения добавляются только через изменение этой спецификации и тестов переходов.

Для каждой стадии фиксируются:

- цель;
- обязательный контекст;
- критерии завершения;
- разрешённые sales moves;
- разрешённые следующие стадии;
- запрещённые действия;
- максимальное количество попыток;
- условия handoff.

## 5. Закрытый перечень SalesMove

Предварительный перечень:

```text
GREET_AND_SET_CONTEXT
ASK_DISCOVERY_QUESTION
REFLECT_CUSTOMER_NEED
CONFIRM_CUSTOMER_NEED
PRESENT_RELEVANT_VALUE
PROVIDE_APPROVED_PROOF
DIAGNOSE_OBJECTION
ANSWER_OBJECTION
CHECK_OBJECTION_RESOLUTION
ASK_FOR_COMMITMENT
OFFER_BOOKING_SLOTS
SCHEDULE_CALLBACK
SEND_CONTEXTUAL_FOLLOW_UP
NURTURE_WITHOUT_PRESSURE
HANDOFF_TO_HUMAN
END_CONTACT
```

Модель не может создать новый тип действия свободным текстом. Она может рекомендовать только значение из allowlist. Окончательный `SalesMove` выбирается серверным кодом.

Пример детерминированного правила:

```text
IF stage = DISCOVERY
AND customer_problem is missing
THEN move = ASK_DISCOVERY_QUESTION

IF active_objection = PRICE
AND objection_cause is missing
THEN move = DIAGNOSE_OBJECTION

IF active_objection = PRICE
AND objection_cause = VALUE
AND approved knowledge is available
THEN move = ANSWER_OBJECTION

IF approved knowledge is unavailable
THEN move = HANDOFF_TO_HUMAN
```

## 6. Customer Sales Memory

Длинная продажа не должна зависеть только от последних сообщений. Создать структурированный `CustomerSalesProfile`.

Минимальные поля:

```text
customer_goal
current_problem
desired_outcome
services_of_interest
decision_criteria
known_objections
active_objection
resolved_objections
budget_status
authority_status
timeline
buying_signals
commitments_made
preferred_channel
preferred_contact_time
communication_style
sales_stage
last_sales_move
next_best_action
follow_up_plan
```

Обновление профиля должно быть evidence-grounded. Модель возвращает операции изменения и точную цитату клиента:

```json
{
  "updates": [
    {
      "field": "timeline",
      "operation": "replace",
      "value": "within 30 days",
      "evidence": "We want this running next month"
    }
  ]
}
```

Если подтверждения в сообщении или разрешённом контексте нет, обновление отклоняется. Контактные данные, согласие, цена, скидки и обязательства проходят дополнительные детерминированные проверки.

## 7. SalesTurnAnalysis

Первый AI-вызов хода анализирует сообщение и не создаёт финальный ответ.

Предварительный контракт:

```json
{
  "observed_stage": "OBJECTION_HANDLING",
  "customer_intent": "evaluate_service",
  "customer_goal": null,
  "pain_points": [],
  "decision_criteria": [],
  "objections": [
    {
      "type": "price",
      "evidence": "That is more than I expected"
    }
  ],
  "buying_signals": [],
  "commitment_level": "interested",
  "customer_tone": "cautious",
  "requested_callback": null,
  "recommended_moves": ["DIAGNOSE_OBJECTION"],
  "requires_human": false,
  "confidence": 0.93
}
```

Требования:

- Pydantic/JSON Schema validation;
- закрытые enum;
- цитата-evidence для каждого содержательного вывода;
- проверка, что evidence действительно присутствует в разрешённом контексте;
- отсутствие свободного customer text в логах, где он не требуется;
- безопасный deterministic fallback при сбое или невалидном ответе провайдера.

## 8. Sales Knowledge Base

Модель не должна полагаться на свои скрытые общие знания о продажах. В production она получает только утверждённые карточки методологии.

Предварительная структура `SalesKnowledgeCard`:

```json
{
  "knowledge_id": "objection-price-001",
  "version": 1,
  "status": "approved",
  "source": {
    "title": "Approved sales methodology",
    "chapter": "Price objections",
    "location": "pages 120-124"
  },
  "principle": "Clarify whether the objection concerns affordability, value, or timing.",
  "applicable_when": [
    "customer_explicitly_objects_to_price"
  ],
  "prohibited_when": [],
  "required_sequence": [
    "acknowledge",
    "ask_one_diagnostic_question",
    "wait_for_answer"
  ],
  "forbidden_actions": [
    "invent_discount",
    "argue_with_customer",
    "claim_guaranteed_roi"
  ],
  "approved_examples": [
    "When you say the price feels high, is the concern the total budget or whether the result will justify it?"
  ]
}
```

Процесс подготовки знаний:

1. Владелец выбирает источники, которые можно законно использовать.
2. Claude Code извлекает кандидатов и указывает точное место источника.
3. Ни одна карточка не публикуется автоматически.
4. Владелец утверждает, редактирует или отклоняет карточку.
5. Код проверяет схему, противоречия, область применения и запрещённые действия.
6. Утверждённая карточка получает неизменяемую версию.
7. Production playbook ссылается только на утверждённые версии.

В runtime книга целиком не используется как неконтролируемый prompt. Используются утверждённые производные правила и допустимые примеры.

## 9. Расширение Business DNA

Добавить версионированный блок `sales_playbook`, например:

```json
{
  "sales_playbook": {
    "sales_goal": "book_consultation",
    "discovery": {
      "required_topics": [
        "current_process",
        "main_problem",
        "desired_outcome",
        "timeline"
      ],
      "max_questions_per_message": 1
    },
    "value_propositions": [],
    "proof_points": [],
    "objection_knowledge_ids": [],
    "commitment_ladder": [
      "confirm_problem",
      "confirm_interest",
      "select_next_step",
      "select_time"
    ],
    "follow_up": {
      "cadence_hours": [24, 72, 168],
      "quiet_hours": ["20:00", "09:00"],
      "maximum_attempts": 3
    },
    "forbidden_claims": [],
    "human_review_triggers": []
  }
}
```

Business DNA является источником бизнес-фактов. Sales Knowledge Base является источником методологии. Эти два вида данных не смешиваются.

## 10. Цикл обработки возражения

Возражение проходит явные состояния:

```text
ACTIVE
    → DIAGNOSED
    → ADDRESSED
    → RESOLVED
       or DEFERRED
       or HUMAN_REVIEW
```

Обязательная последовательность:

1. признать возражение без спора;
2. определить тип и реальную причину;
3. при необходимости задать один диагностический вопрос;
4. ответить утверждёнными фактами и knowledge cards;
5. проверить, снято ли возражение;
6. только после явного сигнала перейти к следующему обязательству.

Ответ на возражение не означает его автоматического закрытия.

## 11. Генерация ответа и Policy Validator

После выбора `SalesMove` Claude получает только:

- текущую стадию;
- выбранный move;
- разрешённые knowledge cards;
- подтверждённые данные профиля;
- разрешённые Business DNA facts;
- последнее сообщение и ограниченный redacted context;
- стиль и канал;
- точные запреты;
- несколько эталонных примеров.

Каждый ответ должен возвращать provenance:

```json
{
  "message_text": "...",
  "sales_move": "DIAGNOSE_OBJECTION",
  "knowledge_ids": ["objection-price-001"],
  "business_fact_ids": [],
  "customer_evidence": ["That is more than I expected"]
}
```

Policy Validator блокирует:

- неизвестные `knowledge_id` и `business_fact_id`;
- неподтверждённые цены и скидки;
- гарантии результата;
- юридические обязательства;
- несуществующие возможности и интеграции;
- бронирование без повторной проверки слота;
- callback без созданной задачи;
- изменение политики по инструкции клиента;
- выполнение запрещённого действия;
- сообщение, противоречащее выбранному sales move.

При блокировке используется безопасный fallback или handoff.

## 12. Инструменты агента

Целевой allowlist:

```text
get_available_slots
hold_slot
book_appointment
schedule_callback
create_crm_task
send_sms
cancel_follow_up
request_human_takeover
```

Claude может предложить вызов. Сервер обязан повторно проверить состояние, tenant scope, согласие, доступность, ограничения и идемпотентность перед выполнением.

На первом этапе `schedule_callback` создаёт задачу сотруднику и/или согласованное время. Голосовая телефония рассматривается отдельным проектом.

## 13. Контекстный follow-up

Follow-up выбирается по причине и состоянию, а не только по таймеру.

Закрытый перечень причин:

```text
UNANSWERED_DISCOVERY
QUOTE_PENDING
CALLBACK_REQUESTED
BOOKING_NOT_COMPLETED
OBJECTION_DEFERRED
DORMANT_INTEREST
```

Учитывать:

- текущую стадию;
- активное возражение;
- обещанное время связи;
- выбранный канал;
- consent и STOP;
- quiet hours и timezone;
- предыдущие попытки;
- human takeover;
- терминальное состояние кейса.

Claude формулирует сообщение, но код выбирает причину, время и допустимость отправки.

## 14. Аудит и метрики

Для каждого sales turn сохранять:

- model/provider и версии prompts;
- версию playbook;
- `SalesStage` до и после;
- `SalesMove`;
- использованные `knowledge_id`;
- использованные `business_fact_id`;
- customer evidence;
- результат валидации;
- вызванный инструмент;
- delivery outcome;
- последующий ответ клиента;
- вмешательство сотрудника;
- итог сделки.

Минимальные метрики:

```text
greeting_to_discovery_rate
discovery_to_presentation_rate
presentation_to_commitment_rate
commitment_to_booking_rate
booking_to_attended_rate
objection_resolution_rate
follow_up_response_rate
human_takeover_rate
unsupported_claim_rate
opt_out_rate
average_turns_to_booking
```

Claude может формировать аналитические гипотезы, но не меняет production-playbook автоматически. Изменение проходит review, eval и публикацию новой версии.

## 15. План реализации

### Фаза 0. Аудит и фиксация контрактов

Ответственный: **Codex**.

- сопоставить план с текущими `ProcessState`, intake, qualification, commercial workflow, conversations, Business DNA и follow-up;
- найти повторно используемые компоненты;
- определить границы нового слоя;
- зафиксировать окончательные enum и API-контракты;
- подготовить ADR для ключевых архитектурных решений;
- определить миграционный и rollback-план.

Результат: утверждённая версия этой спецификации и список контрактов.

### Фаза 1. Доменная модель и persistence

Ответственный: **Codex**.

Предполагаемые модули:

```text
src/domain/sales.py
src/domain/sales_knowledge.py
src/engine/sales_policy.py
src/persistence/sales_profile_service.py
src/persistence/sales_knowledge_repository.py
```

Предполагаемые сущности:

```text
SalesKnowledgeCard
SalesPlaybookVersion
CustomerSalesProfile
ActiveObjection
SalesTurnAnalysis
SalesMoveDecision
SalesOutcome
```

Предполагаемые таблицы:

```text
sales_profiles
sales_turns
sales_knowledge_cards
sales_playbook_versions
sales_objections
sales_follow_up_plans
```

Обязательные свойства: tenant scope, versioning, optimistic concurrency, idempotency, audit и обратимые миграции.

### Фаза 2. Извлечение knowledge cards

Ответственные: **владелец + Claude Code**, затем review **Codex**.

- владелец предоставляет разрешённые источники;
- Claude Code создаёт только кандидатов с provenance;
- владелец утверждает карточки;
- Codex проверяет схему, противоречия и policy boundaries;
- публикация создаёт неизменяемую версию.

### Фаза 3. Anthropic SalesTurnAnalyzer

Ответственный за эксперименты: **Claude Code**.  
Ответственный за интеграцию и безопасность: **Codex**.

- system prompt и structured output;
- 3–5 разнообразных examples для сложных классов;
- evidence validation;
- prompt-injection scenarios;
- deterministic fallback;
- token, latency и quality reporting;
- интеграция с текущим provider-neutral AI boundary.

### Фаза 4. Deterministic SalesPolicyEngine

Ответственный: **Codex**.

- закрытые переходы стадий;
- выбор единственного допустимого move;
- проверка обязательного контекста;
- правила objections, commitment, booking, callback и handoff;
- unit-тесты вида `state + profile + signal → move`;
- запрет на обход существующего `ProcessEngine` для коммерческих обязательств.

### Фаза 5. SalesResponseGenerator и Validator

Эксперименты с формулировками: **Claude Code**.  
Production-интеграция: **Codex**.

- prompt получает уже выбранный move;
- ответ содержит provenance;
- валидатор проверяет знания, факты, обещания и действия;
- безопасный fallback;
- аудит prompt/model/knowledge/playbook versions.

### Фаза 6. UI управления

Ответственный: **Cursor**.

Рабочая область: `web/app` после стабилизации API.

- `Settings → Sales Playbook`;
- каталог knowledge cards;
- approval UI;
- настройка objection handling;
- cadence и quiet hours;
- sales timeline внутри Conversation;
- текущая стадия, цель, активное возражение и next action;
- provenance и причина handoff;
- loading, empty, error и read-only состояния.

Cursor не меняет backend, enum или API-контракты без отдельного изменения спецификации.

### Фаза 7. Инструменты и follow-up

Ответственный: **Codex**; UI-настройки: **Cursor**.

- callback task;
- контекстный follow-up;
- интеграция с booking и CRM;
- consent, STOP, quiet hours и human takeover;
- outbox, retry, ordering и deduplication;
- операционные метрики.

### Фаза 8. Evals и shadow mode

Набор сценариев: **Claude Code**.  
Harness, ожидаемые результаты и CI: **Codex**.

Обязательные группы:

- приветствие;
- неясная потребность;
- несколько потребностей;
- интерес без готовности;
- цена, доверие, timing, competitor;
- «мне надо подумать»;
- callback;
- явное, условное и неоднозначное согласие;
- отказ;
- раздражение и тревога;
- prompt injection;
- скидка и гарантия;
- emergency;
- STOP и отсутствие consent;
- human takeover;
- повтор webhook/message;
- гонки и устаревшее состояние.

Сначала новый агент работает в shadow mode: создаёт анализ и предлагаемый ответ, но не отправляет его клиенту. После сравнения с текущей системой и human review автономность включается поэтапно для низкорисковых стадий.

## 16. Распределение ответственности между инструментами

### Codex

- технический ведущий;
- аудит репозитория;
- архитектура и ADR;
- доменная модель;
- state machine и policy engine;
- persistence, API и миграции;
- интеграция AI-выходов;
- безопасность и policy validation;
- concurrency, idempotency и outbox;
- тестирование и финальное ревью.

### Claude Code

- извлечение кандидатов knowledge cards из предоставленных источников;
- Anthropic prompts;
- structured-output experiments;
- few-shot examples;
- симуляции sales-диалогов;
- adversarial и prompt-injection cases;
- сравнение фактического поведения используемой Anthropic-модели;
- отчёт о качестве, стоимости и latency.

Claude Code не утверждает знания и не определяет production policy.

### Cursor

- интерактивная frontend-разработка;
- редактор playbook;
- knowledge management и approval UI;
- sales timeline;
- отображение stage, objection, next action и handoff;
- локальные визуальные итерации.

Cursor работает по готовым API-контрактам и не изменяет доменную модель самостоятельно.

### Владелец продукта

- выбирает методологию и разрешённые источники;
- утверждает knowledge cards;
- определяет запрещённые обещания;
- утверждает границы автономности;
- задаёт бизнес-метрики;
- принимает решение о переходе из shadow mode в production.

## 17. Git-процесс

Не разрешать нескольким агентам одновременно менять одну ветку или одни файлы.

Рекомендуемые ветки:

```text
main
├── feature/sales-domain-codex
├── feature/sales-prompts-claude
└── feature/sales-ui-cursor
```

Порядок интеграции:

1. спецификация и контракты;
2. доменная модель и API;
3. Anthropic analyzer;
4. policy engine;
5. response generator и validator;
6. UI;
7. инструменты и follow-up;
8. evals и shadow mode;
9. независимое итоговое ревью.

Каждая ветка должна иметь ограниченную область файлов, тесты и отчёт о выполненных изменениях.

## 18. Общие инструкции для агентов

Добавить или обновить корневой `AGENTS.md` со следующими правилами:

```text
- docs/sales-agent-implementation-plan-ru.md является источником истины.
- Не добавлять SalesStage или SalesMove без изменения спецификации.
- Не смешивать SalesStage с ProcessState.
- AI не принимает коммерческие обязательства.
- Все AI-выходы считаются недоверенными и валидируются.
- Каждое sales-утверждение связано с knowledge_id, business_fact_id или customer evidence.
- Не менять файлы вне зоны задачи.
- Не редактировать API-контракт из frontend-задачи.
- Не утверждать автоматически извлечённые знания.
- Запускать указанные тесты перед передачей работы.
- Не обходить tenant scope, consent, human takeover, idempotency или outbox.
```

## 19. Шаблоны задач

### Claude Code: knowledge extraction

```text
Проанализируй только предоставленные источники.
Не добавляй общие знания о продажах.
Для каждого подтверждённого принципа создай SalesKnowledgeCard по схеме проекта.
Укажи точный источник и location.
Не создавай карточку без подтверждения.
Не публикуй и не утверждай карточки.
Верни кандидатов и список возможных противоречий.
```

### Claude Code: prompt/eval

```text
Работай только с Anthropic prompt, structured output и eval fixtures.
Не изменяй SalesPolicyEngine, enum и бизнес-переходы.
Модель может рекомендовать только SalesMove из контракта.
Каждый вывод должен иметь customer evidence.
Добавь позитивные, негативные, неоднозначные и injection-сценарии.
Зафиксируй model, prompt version, tokens, latency и validation result.
```

### Cursor: frontend

```text
Работай только в web/app.
Реализуй UI по docs/sales-agent-implementation-plan-ru.md и существующему API client.
Не изменяй backend, доменные enum и API-схемы.
Не добавляй поля, отсутствующие в контракте.
Сохрани визуальную систему Flywheel.
Добавь loading, empty, error и read-only состояния.
Запусти frontend tests и build.
```

### Codex: backend

```text
Сначала проверь план против текущей архитектуры и зафиксируй контракты.
Сохрани provider-neutral AI boundary.
Реализуй детерминированный выбор SalesMove.
Считай AI output недоверенным.
Сохрани tenant scope, audit, idempotency, optimistic concurrency и outbox.
Добавь meaningful unit, integration и regression tests.
Не меняй существующие коммерческие гарантии без отдельного решения владельца.
```

## 20. Критерии готовности MVP

MVP считается готовым, когда:

- `SalesStage` и `SalesMove` имеют закрытые контракты;
- профиль клиента обновляется только с evidence;
- AI не может напрямую выбрать или выполнить коммерческое обязательство;
- каждый ответ использует только разрешённые knowledge cards и business facts;
- provenance сохраняется в аудите;
- objection flow требует проверки разрешения возражения;
- callback создаёт реальную задачу;
- follow-up учитывает контекст, consent, STOP, quiet hours и takeover;
- сбой AI приводит к безопасному fallback, а не к потере лида;
- критические переходы покрыты тестами;
- eval suite покрывает обычные, неоднозначные и adversarial сценарии;
- shadow-mode результаты проверены до включения автономной отправки;
- unsupported claim и unauthorized action блокируются валидатором;
- владелец может просмотреть источник знания и причину каждого sales move.

## 21. Решение о fine-tuning

Fine-tuning не входит в MVP.

Вернуться к этому решению после накопления:

- достаточного количества реальных диалогов;
- достоверной разметки стадий и возражений;
- результата каждого разговора;
- исправлений сотрудников;
- положительных и отрицательных примеров;
- измеримого слабого места, которое не решается prompt, policy или knowledge retrieval.

Даже после fine-tuning источником истины остаются Sales Policy Engine, Sales Knowledge Base и Business DNA. Fine-tuned model может улучшать классификацию или формулировку, но не получает право менять правила.

## 22. Первый следующий шаг

Начать с **Фазы 0**:

1. провести полный аудит текущей реализации;
2. сопоставить новые сущности с существующими моделями;
3. утвердить окончательные `SalesStage`, `SalesMove` и `SalesTurnAnalysis`;
4. зафиксировать API и persistence contracts;
5. только после этого создавать параллельные ветки для Claude Code и Cursor.

До завершения Фазы 0 не начинать независимую реализацию одной и той же функциональности несколькими агентами.

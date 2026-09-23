# Narrative Engine для SillyTavern

Narrative Engine — устанавливаемое расширение SillyTavern без форка ядра. Обычная
модель SillyTavern пишет художественный RP-текст, а отдельная Director-модель
ведёт continuity, физическое состояние, знания и секреты, отношения, сюжетные
ветки, автономный мир, память, аудит и спрайты. Требуются только две физические
LLM, а логические роли объединяются в PRE/POST запросах.

Проверено на release SillyTavern 1.19.0, commit
`06bde939fb1e9c4c8d8641d810f0a916b5bce127`. Точные результаты сверки API лежат
в `reports/`.

## Установка UI Extension

1. В SillyTavern откройте **Extensions → Install extension**.
2. Укажите `https://github.com/Gam1409/Narrative-Engine`.
3. Перезагрузите SillyTavern и откройте **Extensions → Narrative Engine**.
4. Выберите Director provider и model, нажмите **Test connection**.
5. Настройте аудит и модули, затем включите расширение.

В Browser-only режиме доступны локальный OpenAI-compatible endpoint без ключа,
Ollama либо текущее подключение SillyTavern. API key принципиально отсутствует в
UI: `extensionSettings` хранится открытым текстом. Для endpoint с ключом нужен
Server Plugin.

## Server-assisted режим

Скопируйте `server-plugin` в `SillyTavern/plugins/narrative-engine`, выполните в
этой папке `npm install --omit=dev`, включите плагины и перезапустите ST:

```yaml
enableServerPlugins: true
```

```text
NARRATIVE_ENGINE_DIRECTOR_URL=https://director.example/v1
NARRATIVE_ENGINE_DIRECTOR_MODEL=qwen3-coder-heretic
NARRATIVE_ENGINE_DIRECTOR_API_KEY=секрет
```

Доступны дополнительные env-настройки timeout/retry, лимитов, каталога БД и
allowlist частных хостов. Loopback разрешён для локальной модели. SQLite по
умолчанию создаётся в постоянном `DATA_ROOT/_storage/narrative-engine`, а не в
обновляемой папке расширения.

## Цикл хода и fallback

```text
сообщение user → PRE Director → временный Director Packet → RP-модель
                → готовый ответ → POST audit/delta → state/memory/sprites
```

PRE вызывается один раз перед генерацией, POST — один раз после полного ответа,
не на каждый streaming token. STRICT допускает максимум один узкий rewrite и
один re-audit. При недоступном Director обычный RP продолжается без устаревшего
packet, поздние ответы отбрасываются, UI показывает DEGRADED/OFFLINE.

## Состояние, сюжет и память

Структурированно хранятся сцена, персонажи, одежда и позы, предметы, локации,
внутриигровое время, отношения, границы знаний, сюжетные ветки, планы NPC и
мировые события. Delta применяется атомарно и содержит provenance. Checkpoint и
delta в metadata сообщений позволяют rebuild после edit/delete/swipe.

В браузере большие данные находятся в `localforage`, а `chatMetadata` содержит
только компактное состояние и указатели. На сервере используется SQLite. В PRE
попадают последние сообщения и только Top-K релевантных эпизодов, а не весь
старый чат. World Info остаётся canon; Narrative Engine хранит динамику отдельно.

Character Card может содержать необязательное поле
`character.data.extensions.narrative_engine` со `spriteManifest`,
`stateDefaults` и `directorHints`.

## Спрайты, группы и VN mode

Даже при 2000+ спрайтах код сначала фильтрует manifest по персонажу, костюму,
эмоции и позе. Director получает 5–30 кандидатов и возвращает точное имя либо
`KEEP`; имя вне shortlist не применяется. Используются штатные команды
`/expression-set` и `/costume`. В группе speaker определяется по реальному
сообщению/аватару, а спрайты остальных участников не сбрасываются.

## Команды и отладка

Поддерживаются `/narrative-engine on|off`, `/ne-state`, `/ne-threads`,
`/ne-timeline`, `/ne-memory`, `/ne-rebuild`, `/ne-audit`, `/ne-director`,
`/ne-sprite`, `/ne-export`.

Панель показывает provider status, PRE/POST latency, сцену и время, участников,
ветки, найденную память, последний audit, sprite decisions, token estimate и
ошибки. Есть просмотр state/timeline/threads/memory/packet, импорт/экспорт,
rebuild, health check, очистка transient cache и redacted diagnostics.

## Безопасность

- Ключи не сохраняются в браузере, metadata, логах или diagnostics.
- Server Plugin использует только фиксированный endpoint из env.
- DNS/IP проверка защищает от SSRF; private сети требуют явный allowlist.
- Есть body/rate limits, timeout, retries, ограничение ответа и parameterized SQL.
- Нет `eval` и произвольных путей файловой системы.
- Server Plugins SillyTavern не sandboxed — устанавливайте только проверенный код.

## Проверка и устранение проблем

```powershell
npm test
npm run test:server
npm run check
```

- Нет server route: включите `enableServerPlugins` и перезапустите ST.
- Director Offline: проверьте model/endpoint/CORS или env и `/health` плагина.
- Нет спрайта: включите Character Expressions и проверьте manifest/shortlist.
- Pending reconciliation: восстановите Director и выполните **Rebuild state**.
- После edit/swipe остались старые факты: выполните `/ne-rebuild`.

Лицензия: MIT.

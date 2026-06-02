# Spec Inconsistencies in `task.md`

2. **Outbox/event timing conflicts across phases**

   `task.md:86` and `task.md:90` say outbox events are inserted inside the trade transaction, and `task.md:98` says every trade emits both trade and price-change events. But Phase 3 at `task.md:324` says trade starts emitting those events then.

   Decide whether Phase 0 writes outbox rows already, or whether outbox/event insertion is Phase 3-only.

5. **Compose readiness does not cover host-run app**

   `task.md:177` says the Node app runs on the host, not in compose. `task.md:223` says compose healthchecks and `depends_on` ensure Postgres/Redis are ready before app start.

   `depends_on` will not gate a host-run process. The spec needs a host-side wait/startup script if app startup readiness matters.

6. **Graceful shutdown combines separate process responsibilities**

   `task.md:181` splits the HTTP app, outbox relay, and trade-notifications consumer into separate host processes. But `task.md:226` describes one SIGTERM flow that stops HTTP and the `XREADGROUP` loop.

   Split this into separate shutdown behavior for the HTTP app, relay, and consumer.

7. **DLQ alert is optional in one place and required in another**

   `task.md:267` marks DLQ length alerting as optional. Phase 3 at `task.md:331` says DLQ length alerts are added.

   Pick whether DLQ alerts are required in Phase 3 or an optional add-on.

8. **Redis stream trimming does not block producers by itself**

   `task.md:163` and `task.md:339` connect capped streams via `MAXLEN` / `MINID` with "drop-oldest vs. block-producer" behavior.

   Redis stream trimming can enforce retention/drop behavior, but producer blocking requires explicit application-level admission control or backpressure logic.

9. **Balance credits are mentioned, but only buys are defined**

   `task.md:52` defines buying shares. Payouts are out of scope at `task.md:55` and `task.md:284`. But `task.md:91` says the trade transaction "debits/credits balance."

   Either define sells/refunds/other crediting behavior, or change this to "debits balance" for the current buy-only scope.

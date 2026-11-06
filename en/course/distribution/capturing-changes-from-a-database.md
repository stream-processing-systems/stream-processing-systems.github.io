# Capturing changes from a database

> Why reading a table again and again misses changes, how change data capture reads the changes a database already records, how a snapshot joins the changes without a gap, and what a row change does not say.

Source: https://stream-processing-systems.github.io/en/course/distribution/capturing-changes-from-a-database/

Our AI assistant charges for tokens by plan. The plans live in a PostgreSQL
database, in a table `plans`, one row per account:

| `account_id` | `plan` | `price_per_1k_tokens` | `monthly_limit` |
| --- | --- | --- | --- |
| `acme` | `team` | 0.40 | 50,000 |
| `beta` | `team` | 0.40 | 50,000 |
| `gamma` | `starter` | 0.60 | 5,000 |

The support team changes this table through its own tool. At 14:20 on
February 2, `acme` moves to the `business` plan, with a lower price and a
larger limit. The usage processor reads usage records from the
[log](https://stream-processing-systems.github.io/en/course/distribution/a-queue-or-a-log.md), and it needs the plans too, to turn tokens into
money and to warn customers who approach their limit. A table is not a log:
it holds the current rows and does not tell anyone that a row has changed. How
can every change in `plans` reach the processor, in order and without gaps?

## Reading rows is not reading changes

The simplest idea is to ask the database again and again. Every five minutes,
the processor runs a query for the rows changed since its last run, using a
column `updated_at` that records when each row was last changed.

At 14:20, support moves `acme` to `business`: the price drops from 0.40 to
0.30 per thousand tokens, and the limit rises to 500,000. At 14:22, they
correct the limit to 400,000 without changing the price. The query at 14:25
returns one row: price 0.30, limit 400,000, `updated_at` 14:22.

The processor misses the intermediate limit of 500,000. It also cannot tell
when the price changed: `updated_at` now points to the limit correction,
overwriting the time of the plan change.

![Reading rows misses intermediate changes](diagrams/polling-misses-intermediate-value.svg)

Deleted rows are worse. When `gamma` closes its account and its row is
removed, a query over the rows that exist returns nothing about it. And the
query relies on `updated_at`. A script that fixes rows directly and forgets to
set it makes its changes invisible.

Asking more often narrows the gaps without closing them, and every query adds
load to the database that serves the support tool.

## Changes the database already records

A database already writes down every change, for its own sake. Before
PostgreSQL changes the files that hold a table, it records the change in its
**write-ahead log (WAL)** and stores that record safely. After a crash, it
repeats the logged changes that had not yet reached the files.[^1] So the
WAL holds every change in the order the database made it, including deletes.

Reading changes from there and turning them into records for other systems is
called **change data capture**, or CDC. The WAL describes changes in terms of
how the database stores them. PostgreSQL can decode them into changes of
table rows that a program can understand; this is called logical
decoding.[^2]

Debezium, a widely used CDC tool, does this for PostgreSQL and several other
databases. It writes the changes of each table to its own Kafka topic, one
record per changed row, with the row's primary key as the record's key.[^3]
By default, PostgreSQL passes only the primary key of the old row, so the
`plans` table is set to `REPLICA IDENTITY FULL` to include all its previous
values.[^3] The change at 14:20 becomes a record like this, slightly
shortened:

```json
{
  "before": { "account_id": "acme", "plan": "team", "price_per_1k_tokens": 0.40, "monthly_limit": 50000 },
  "after": { "account_id": "acme", "plan": "business", "price_per_1k_tokens": 0.30, "monthly_limit": 500000 },
  "op": "u",
  "source": { "table": "plans", "lsn": 2471839104, "ts_ms": 1770042000000 }
}
```

The record holds the row before and after the change and the kind of change:
`u` for update; inserts and deletes have their own letters.[^3] The `lsn` is
the change's position in the WAL, and `ts_ms` is when the database made it.
The correction at 14:22 becomes a second record, so the processor sees both
values of the limit and the moment of each.

A deleted row gives a record with the letter `d` and an `after` that is
`null`. Debezium follows it with a [tombstone](https://stream-processing-systems.github.io/en/course/distribution/how-long-does-kafka-keep-history.md):
a separate record with the same key and a `null` value, so that a compacted
topic can remove the account completely.[^3] Since each change
replaces the previous row for its key, the `plans` topic is a natural
candidate for compaction.

## Rows that existed before

The WAL does not keep changes forever. The database removes old parts once it
no longer needs them, so the rows created last year are no longer in it as
changes. A processor that started reading the WAL today would learn about
`beta` and `gamma` only when someone changed them.

So capture starts with a **snapshot**: a reading of the current rows of the
table at one moment. Debezium writes each row of the snapshot as a record of
its own, marked with the letter `r` for read, and then continues with the
changes from the WAL.[^3]

These snapshot records mean "this row existed when capture started." They are
not new accounts. A processor that greeted every `r` record as a new customer
would send a welcome email to everyone on the day capture began.

## A handoff without a gap

The snapshot and the changes have to meet at one point. Suppose the snapshot
reads `acme` as `team` at 14:19, and reading the WAL starts at a position after
the change of 14:20. The processor then has `acme` on `team` and never sees
the change. If reading the WAL starts too early instead, some changes arrive a
second time. A change repeated right after itself is harmless: it sets the row
to the same `after` value again. A repeat that arrives after a newer change is
not. If the change of 14:20 came again after the correction of 14:22, the
limit would go back to 500,000 until the correction arrived once more.

Debezium joins them like this: inside one transaction, it first reads the
current WAL position, then reads the tables, and when the snapshot is done, it
reads the WAL from the position it noted.[^3] The snapshot describes the table
at that position, and the changes start right after it. It is the same rule as
in a [consistent checkpoint](https://stream-processing-systems.github.io/en/course/reliability/recovering-a-consistent-computation.md):
the state and the position must describe the same moment.

![A handoff without a gap](diagrams/snapshot-and-wal-boundary.svg)

After the snapshot, the reading position has to survive restarts of the
capture. Debezium saves its position, the `lsn` it has reached, in its own
offset storage. PostgreSQL keeps the WAL that this position still needs
through a replication slot: the database does not remove the parts of the WAL
that a slot still needs, even while nobody is connected. If Debezium stops for
a day, it resumes from its saved position without losing changes, as long as
the slot still exists and the WAL it needs is still there.[^4] The cost falls
on the database: the WAL grows on its disk until the reader
returns, and a slot that nobody uses anymore has to be removed before the disk
fills.[^2]

After a crash of the database, a slot can also return to an earlier position,
and recent changes are sent again.[^2] So readers of the `plans` topic must
handle repeats, including old changes that come after newer ones. A reader
can keep, with each row, the position of the change that set it, and skip a
change that is not newer, as with the
[versions](https://stream-processing-systems.github.io/en/course/reliability/one-result-one-external-effect.md) of a total.
Applying changes then becomes idempotent. In our example, the `lsn` of the change at 14:22 is greater than that of 14:20,
so the old limit cannot come back.

## What a row change does not say

The record from 14:22 says that `acme`'s limit went from 500,000 to 400,000.
It does not say why. A support worker may have corrected a typo, or the
customer may have chosen a smaller limit. For billing, the difference matters:
a correction means the limit was never 500,000 for the customer, while a
choice means it was, for two minutes. The row records the
[current state](https://stream-processing-systems.github.io/en/course/fundamentals/what-does-an-event-tell-us.md), and a change of
state is not the same as the event that caused it.

When the reason matters, the application can write it down as an event. The
support tool changes the row and, in the same transaction, adds a record
"limit corrected" to an [outbox](https://stream-processing-systems.github.io/en/course/reliability/one-result-one-external-effect.md)
table. Debezium captures the outbox table and publishes the event to the log
only after the transaction commits.[^5]

A captured table also becomes something its readers depend on. Its columns
are now the fields of records that other programs read. Renaming a column in
the database changes those records for every reader of the topic.

The processor now has two inputs: usage records, which add up, and plan
changes, which replace each other and form a table that is current at any
moment. A request by `acme` at 14:19:58 has its usage record arrive at
14:20:03, after the plan change of 14:20 has already reached the processor.
Which price applies to it, and how should a stream of events be combined with
a table that keeps changing?

## What to remember

- Asking a table for changed rows sees its current state, not every change: it
  misses intermediate values and deleted rows.
- Change data capture reads the changes a database already records in its own
  log, in order and including deletes, and writes them as records keyed by the
  row's primary key.
- Capture starts with a snapshot of the current rows, and the snapshot and the
  changes must meet at one position. Readers must handle repeated changes,
  for example by keeping the position of the change that set each row.
- A row change records a new state, not its reason. When the reason matters,
  the application writes an event, for example through an outbox.

## References

[^1]: [PostgreSQL 18: Write-Ahead Logging (WAL)](https://www.postgresql.org/docs/18/wal-intro.html).
[^2]: [PostgreSQL 18: Logical Decoding Concepts](https://www.postgresql.org/docs/18/logicaldecoding-explanation.html).
[^3]: [Debezium 3.7: PostgreSQL connector, Snapshots and Data change events](https://debezium.io/documentation/reference/3.7/connectors/postgresql.html#postgresql-snapshots).
[^4]: [Debezium 3.7: PostgreSQL connector, PostgreSQL becomes unavailable](https://debezium.io/documentation/reference/3.7/connectors/postgresql.html#postgresql-becomes-unavailable).
[^5]: [Debezium 3.7: Outbox Event Router](https://debezium.io/documentation/reference/3.7/transformations/outbox-event-router.html).

## Further reading

- Martin Kleppmann and Chris Riccomini, *[Designing Data-Intensive Applications](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781098119058/)*,
  2nd ed. (O'Reilly Media, 2026), chap. 12, "Stream Processing." The section
  on databases and streams explains why other systems need a database's
  changes, why an initial snapshot must match a position in the change log,
  and how capturing changes differs from recording events.

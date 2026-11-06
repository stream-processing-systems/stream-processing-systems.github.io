# How long does Kafka keep history?

> How retention decides how far back a log can be read, why copies on several brokers protect against a different failure, and when keeping only the latest value of each key is enough.

Source: https://stream-processing-systems.github.io/en/course/distribution/how-long-does-kafka-keep-history/

On February 10, the team of our AI assistant fixes the bug introduced eight
days earlier and wants to [recompute usage](https://stream-processing-systems.github.io/en/course/distribution/consumer-groups-and-replay-in-kafka.md).
It restores the last checkpoint before the bug, from 06:01 on February 2.
The `usage` topic uses Kafka's default seven-day retention, and in this case
the segments needed to continue from that checkpoint have already been
deleted. The team can restore the saved state, but the log no longer has all
the input needed to bring the totals up to date.

So the log keeps history only for a while, and that time is a setting. How
long should records stay, what protects them while they stay, and does every
topic need to keep every record?

![When history no longer reaches the checkpoint](diagrams/retention-and-replay-gap.svg)

## Retention: how long records stay

How long a topic keeps its records is called **retention**. Kafka can limit it
by time, by the size of each partition, or both. By default, a topic keeps
records for seven days and has no size limit.[^1]

Kafka stores each partition in files called segments and deletes old records a
whole segment at a time. A segment goes once even its newest record is older
than the retention time, and age is judged by the records' timestamps.[^1]
Usually, records stay somewhat longer than the setting, and the earliest
available offset moves forward in jumps. It is not a promise, though: a record
that arrives late with an old timestamp gets less time, and a size limit can
remove segments earlier.

The right retention follows from what readers need. Our list, from the
shortest need to the longest:

| Need | How far back the log must reach |
| --- | --- |
| Restart from a [checkpoint](https://stream-processing-systems.github.io/en/course/reliability/what-must-survive-a-restart.md) | To the oldest checkpoint the processor may restart from: minutes |
| Catch up after a processor outage | The longest outage we plan for: hours or days |
| Recompute after a bug | As long as a bug can go unnoticed: our bug went eight days |
| The finance team's monthly check | The whole month, plus the days the check takes after it ends |

The longest need decides: about forty days. Storage grows with the rate of
records. If the assistant writes 1,000 records a second on average, at about
300 bytes each, one day is about 26 GB, and forty days about 1 TB in each copy.
That is affordable here. For older history, such as usage from last year that
customers may dispute, Kafka can move old segments to cheaper remote storage,
such as object storage, and keep only the recent ones on the brokers' disks.
This is called tiered storage.[^2]

## When a reader falls behind retention

Retention deletes records whether or not someone has read them. Suppose the
finance reader is stopped on February 3 for a migration and started again on
February 11. Its committed offset points to records of February 3, and with
seven-day retention those records are gone.

What happens next is a setting too. When a consumer's offset no longer exists,
Kafka moves it to the earliest or the latest available offset, and by default
to the latest.[^3] The finance reader would quietly jump to the newest records
and skip eight days. Its check would then compare part of the month with the
billing system and find differences that are not real, or miss real ones.

A reader that must not skip records is better off with an error. With
`auto.offset.reset=none`, the consumer reports an error instead of moving, and
people decide what to do: find the records elsewhere or accept the gap knowingly.[^3]

## Copies on other brokers

Retention protects against age. A failing disk is a different danger: if the
broker that stores partition 0 loses its disk, a seven-day or a forty-day
retention does not matter.

So Kafka keeps each partition on several brokers. One copy, on the **leader**,
receives all writes; the other copies, the **followers**, read from the leader
and repeat its writes. The leader together with the followers that keep up
with it are called the **in-sync replicas**. With three copies, partition 0
might have its leader on `broker-1` and followers on `broker-2` and
`broker-3`. If the leader fails, normally one of the in-sync followers becomes
the new leader.[^4]

When does a write count as stored? By default, the producer waits until all
current in-sync replicas have the record.[^5] Kafka's promise is that such a
record is not lost as long as at least one in-sync replica stays alive.[^4]
The word "current" matters. Suppose `broker-2` and `broker-3` fall behind and
leave the in-sync set. The leader alone is now all the in-sync replicas, and
it acknowledges writes by itself. If `broker-1` then loses its disk, the only
current copy is gone, and the records it acknowledged in that time are lost.

A topic can require a minimum number of in-sync replicas for a write. With
the producer waiting for all of them and `min.insync.replicas=2`, the leader
refuses writes while it is the only one in sync.[^1] The gateway then gets an error and keeps the record to send again,
which is [at-least-once delivery](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md)
at work. The price is availability: while two of three brokers are down, the
topic accepts no usage. The default, one, keeps accepting and risks the
loss.[^4] For records that go into bills, we prefer the refusal.

![A minimum number of in-sync replicas](diagrams/replica-write-minimum.svg)

Copies protect against broken machines, not against wrong data. Retention
deletes a record on every copy at once. If the gateway writes wrong records,
all three brokers keep them faithfully.

## Keeping only the latest value

Not every topic needs its whole history. The usage processor publishes each
account's current total for the month to a topic `account-totals`, and the
usage page reads it. Partition 0 of that topic receives:

| Offset | Key | Value |
| --- | --- | --- |
| 0 | `acme` | 1,000 |
| 1 | `acme` | 1,400 |
| 2 | `delta` | 300 |
| 3 | `acme` | 2,000 |

Each new total replaces the previous one for its key. A page that starts
reading this topic needs only the last value of each account. For such topics,
Kafka offers **compaction**: instead of deleting records by age, it keeps at
least the last record for each key and removes older records with the same
key.[^4] After compaction, partition 0 holds `delta` 300 at offset 2 and `acme`
2,000 at offset 3. Offsets do not change, so a gap appears where the removed
records were. A reader that reads the topic from the start still arrives at
the latest value of every key.[^4]

![Keeping only the latest value](diagrams/compaction-keeps-offsets.svg)

To remove a key completely, the producer writes a record with that key and a
`null` value, no value at all, called a **tombstone**. An empty string would
not do: compaction would keep it as the key's latest value. Compaction removes
the key's earlier records, and the tombstone itself is removed later, by
default after a day (`delete.retention.ms`). A reader that is away longer may
never see that the key was deleted.[^4] The same holds for a reader that
rebuilds the table from the start: it has to reach the end of the topic within
that day, or it may read the last total of a closed account and miss its tombstone.

Compaction on the `usage` topic would be a mistake. Its key is the account
too, but its records do not replace each other: each one adds tokens. After
compaction, `acme` would keep only `u-103` with 600 tokens, and a recomputed
total would be 600 instead of 2,000. Records that add up need retention by
time. Records that replace each other can be compacted. One system usually has
both kinds of topics.

A compacted topic keeps the latest value of each key, which is what a table
holds. The assistant already has a table of that kind, in a database: the plan
of each account, with its price per token and monthly limit. The processor
needs it to turn tokens into money, and the plan can change at any moment, when
`acme` moves to a larger plan at 14:20. Copying the whole table now and then
would miss the moment of the change and load the database. How can the
changes made in a database become records in a log?

## What to remember

- Retention decides how long a topic keeps records, by time or size, and Kafka
  deletes whole segments. It follows from the longest need of any reader.
- A reader whose offset has been deleted by default jumps to the newest
  records. A reader that must not skip records should get an error instead.
- Copies on several brokers protect against a broken machine. A minimum number
  of in-sync replicas trades availability for not losing acknowledged records.
  Copies do not protect against wrong data.
- Compaction keeps the latest record of each key. It suits records that
  replace each other and breaks records that add up.

## References

[^1]: [Apache Kafka 4.4: Topic Configs, retention.ms, retention.bytes, and min.insync.replicas](https://kafka.apache.org/44/configuration/topic-configs/).
[^2]: [Apache Kafka 4.4: Tiered Storage](https://kafka.apache.org/44/operations/tiered-storage/).
[^3]: [Apache Kafka 4.4: Consumer Configs, auto.offset.reset](https://kafka.apache.org/44/configuration/consumer-configs/).
[^4]: [Apache Kafka 4.4: Design, Replication and Log Compaction](https://kafka.apache.org/44/design/design/).
[^5]: [Apache Kafka 4.4: Producer Configs, acks](https://kafka.apache.org/44/configuration/producer-configs/).

## Further reading

- Gwen Shapira, Todd Palino, Rajini Sivaram, and Krit Petty, *[Kafka: The Definitive Guide](https://www.oreilly.com/library/view/kafka-the-definitive/9781492043072/)*,
  2nd ed. (O'Reilly Media, 2021), chap. 6, "Kafka Internals," and chap. 7,
  "Reliable Data Delivery." The first shows how partitions are replicated and
  stored in segments, and how retention and compaction remove old records. The
  second explains which settings decide whether an acknowledged record can be
  lost.

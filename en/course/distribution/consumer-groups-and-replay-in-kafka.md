# Consumer groups and replay in Kafka

> How Kafka shares partitions among the consumers of a group and moves them when one fails, why a committed offset needs matching state, and how independent groups read the same history and read it again.

Source: https://stream-processing-systems.github.io/en/course/distribution/consumer-groups-and-replay-in-kafka/

Three processors read the [`usage` topic](https://stream-processing-systems.github.io/en/course/distribution/topics-partitions-and-offsets-in-kafka.md)
of our AI assistant: A reads partition 0, B reads 1, and C reads 2. At 11:00 on
February 2, the machine of processor A fails. Partition 0, with the records of
`acme` and `delta`, has no reader, and the usage pages of both accounts stop
changing.

Kafka can notice this, hand partition 0 to another processor, and tell it
where A stopped. Meanwhile, the finance team wants to read the same topic for
its own check, and next week someone may want to count all of February again.
How does Kafka decide who reads which partition, and what does a processor
need, besides a position, to continue correctly?

## A group shares the partitions

Consumers that share the work of reading a topic form a **consumer group**.
Each consumer names its group when it connects; ours is `usage-totals`. Kafka
assigns each partition of the topic to exactly one consumer in the group.[^1]
Together, the consumers of a group read every partition once, as one reader
divided into parts:

| Consumer in `usage-totals` | Partition |
| --- | --- |
| A | 0 |
| B | 1 |
| C | 2 |

A fourth consumer in this group would get no partition and wait, because one
partition goes to one consumer of the group. This is the
[limit of partitions](https://stream-processing-systems.github.io/en/course/distribution/splitting-a-log-into-partitions.md) in Kafka's terms.

Kafka also has another way to read. Since version 4.2, it offers share groups,
in which several consumers read the same partition and acknowledge each record
separately.[^2] That is the [queue](https://stream-processing-systems.github.io/en/course/distribution/a-queue-or-a-log.md) way of reading, on top
of a log. It suits independent tasks; our totals need ordinary consumer
groups, where all records of one key reach one consumer.

## When a consumer leaves or joins

A consumer in a group regularly sends a signal that it is alive. If the
signals stop for longer than a set timeout, Kafka considers the consumer dead
and gives its partitions to the other consumers of the group. When a new
consumer joins, Kafka moves some partitions to it.[^1] Moving partitions among
the consumers of a group is called a **rebalance**.

With the default settings of Kafka's Java client, a consumer is considered dead
after 45 seconds without signals.[^3] So at about 11:00:45, partition 0 goes
to B, say, and B now reads partitions 0 and 1. For those 45 seconds, the usage
pages of `acme` and `delta` stand still, and then they catch up. A consumer
also loses its partitions if it is alive but slow: if it does not ask for new
records for five minutes, by default, it leaves the group.[^3] This is the
[slow processor that could keep running after losing its partition](https://stream-processing-systems.github.io/en/course/distribution/splitting-a-log-into-partitions.md#moving-a-partition-to-another-processor):
once another consumer owns the partition, the old one must stop sending
results for it.

![When a consumer leaves or joins](diagrams/consumer-group-rebalance.svg)

## Committed offsets

B now needs a place in partition 0 to start from. A's position lived in A's
memory and is gone. For this reason, the group stores its progress in Kafka:
for each partition, the offset of the next record to read. Writing this offset
to Kafka is called a commit, and the stored value is the **committed
offset**.[^1] B starts reading partition 0 from the offset that A committed
last.

When to commit decides which failure is possible. A consumer that commits
before processing the records may lose them: if it fails in between, the new
owner starts after records that nobody processed. A consumer that commits
after processing may process them twice: if it fails in between, the new owner
reads them again.[^4] These are the
[at-most-once and at-least-once](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md)
guarantees, now on the stretch between the log and the processor.

By default, the Java client commits automatically, every five seconds, the
offsets of the records that `poll` has returned.[^3] That suits a consumer that
finishes each batch before asking for the next one. A consumer that hands
records to other threads and polls again can commit offsets for records that
are still being processed, and a failure then loses them.[^1]

## An offset without the state

Suppose A committed offset 4 before it failed: it had counted the records at
offsets 0 to 3, and `acme`'s total in its memory was 1,400 tokens. B starts at
offset 4 and reads `u-103`, 600 tokens. But B has no state for `acme`, so its
total for the account is 600, not 2,000. The committed offset carried A's
position to B. A's total was in A's memory and failed with it.

A committed offset is [reading progress](https://stream-processing-systems.github.io/en/course/reliability/what-must-survive-a-restart.md)
and nothing more. The new owner of a partition also needs the state that
matches that offset: the state that includes exactly the records before it, as
in a [consistent checkpoint](https://stream-processing-systems.github.io/en/course/reliability/recovering-a-consistent-computation.md).
Kafka's consumer cannot provide this, because it does not know what the
processor keeps in memory.

There are two common ways to keep the offset and the state together. The
processor can store the offset with its results, for example in the same
database transaction, and start from that stored offset instead of the
committed one.[^1] Or it can keep the offsets in its own checkpoints, next to
its state. Flink does the latter: its Kafka source restores offsets from the
checkpoint, does not rely on committed offsets for recovery, and commits them
only so that others can see its progress.[^5] In this example, the saved state is from before the copy at offset 3.
Either way, B restores `acme`
with 1,400 tokens and offset 3, recognizes the copy of `u-102`, counts `u-103`,
and reaches 2,000.

![An offset without the state](diagrams/offset-and-matching-state.svg)

## Independent readers

The finance team starts its own consumer with its own group, `finance-check`.
Kafka keeps committed offsets for each group separately, so the two groups
read the same partitions without affecting each other. On the evening of
February 5, their offsets look like this:

| Group | Partition 0 | Partition 1 | Partition 2 |
| --- | --- | --- | --- |
| `usage-totals` | 251,408,377 | 248,915,102 | 250,301,977 |
| `finance-check` | 64,120,550 | 63,498,331 | 63,905,720 |

The usage processors are near the newest records. The finance reader, which
started from the earliest records, is far behind and moves at its own pace.
Neither group's progress deletes anything.

A new group has no committed offsets yet. By default, its consumers start at
the end of each partition and read only records that arrive after they
connect.[^3] The finance reader needs the opposite, so it is configured to
start from the earliest available offset.

## Replay on purpose

On February 10, the team finds a bug. Since the
[update at 06:05 on February 2](https://stream-processing-systems.github.io/en/course/reliability/what-must-survive-a-restart.md),
the processor has also counted records with `status` `failed`: requests that
ended in an error, which customers do not pay for. The records carry the
status, so a fixed processor can tell them apart. After the fix, everything
since the update must be counted again.

The replay has to start from a state and offsets that match. The last
checkpoint before the update, from 06:01, holds both: the totals and the lists
of counted IDs, and for each partition the offset up to which they are
counted. The processor restores that checkpoint, if it is still kept, and
reads each partition from the checkpoint's offset. A processor that keeps
offsets in its checkpoints, as Flink does, does this by itself. For our group,
we stop all `usage-totals` consumers and restore their state. While the group
is inactive, we reset its offsets with Kafka's command-line tool, from a file
that lists the topic, partition, and offset for each partition:[^6]

```sh
kafka-consumer-groups.sh --bootstrap-server broker-1:9092 \
  --group usage-totals --reset-offsets --from-file checkpoint-0601.csv --execute
```

Then we start the consumers with the fixed code and the restored state.

The same tool can move offsets to a time instead. It then finds the first
records whose timestamps are after that time, and a timestamp says nothing
about which records a checkpoint included. If at 06:05 the processor was
[20 minutes behind](https://stream-processing-systems.github.io/en/course/distribution/a-queue-or-a-log.md), as it is at the morning peak, its
state ended at records written around 05:45. A reset by time suits a reader that has no state to
match.

Without a checkpoint from before the update, the totals have to be counted
from the first record of the month. If the current totals stayed, every
request since the update would be added a second time, and a
[list of IDs](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md) kept for
24 hours would not recognize records from last week.

The receivers need a rule for the recomputed results too. The usage page
keeps the [highest version](https://stream-processing-systems.github.io/en/course/reliability/one-result-one-external-effect.md)
of each total, and a version is the position of the last record the total
includes. The recomputed totals carry the same positions as the old ones, so
the page would reject them as old. The recomputation needs versions of its
own, for example a run number placed before the position, so that every total
of the second run is newer than any total of the first. The billing system,
which treats a known usage ID with a different token count as an error, needs
an explicit correction. Replay recomputes the results; what a recomputed
result means is up to each receiver.

Replay also needs the records themselves. By default, Kafka keeps the records
of a topic for seven days.[^7] By February 10, eight days have passed since
the bug appeared. With the default retention, the segments holding the start
of that period may already be deleted. The log would then lack part of the
input needed to recompute the totals.

## What to remember

- A consumer group shares a topic's partitions: each partition goes to one
  consumer of the group. When a consumer fails or joins, a rebalance moves
  partitions.
- The committed offset is the group's progress, stored in Kafka. Committing
  before processing risks loss, committing after it risks repeats.
- A committed offset carries no state. The new owner of a partition needs
  state that matches the offset, so offsets are kept with the state or with
  the results.
- Different groups read the same topic independently. Replay starts from the
  offsets of a checkpoint together with its state, and receivers need a rule
  for recomputed results.

## References

[^1]: [Apache Kafka 4.4: KafkaConsumer, Consumer Groups and Topic Subscriptions; Offsets and Consumer Position; Storing Offsets Outside Kafka](https://kafka.apache.org/44/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html).
[^2]: [Apache Kafka 4.2.0 Release Announcement](https://kafka.apache.org/blog/2026/02/17/apache-kafka-4.2.0-release-announcement/).
[^3]: [Apache Kafka 4.4: Consumer Configs](https://kafka.apache.org/44/configuration/consumer-configs/).
[^4]: [Apache Kafka 4.4: Design, Message Delivery Semantics](https://kafka.apache.org/44/design/design/).
[^5]: [Apache Flink 2.3: Kafka Source, Consumer Offset Committing](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/connectors/datastream/kafka/#consumer-offset-committing).
[^6]: [Apache Kafka 4.4: Basic Kafka Operations, Managing consumer groups](https://kafka.apache.org/44/operations/basic-kafka-operations/).
[^7]: [Apache Kafka 4.4: Topic Configs, retention.ms](https://kafka.apache.org/44/configuration/topic-configs/).

## Further reading

- Gwen Shapira, Todd Palino, Rajini Sivaram, and Krit Petty, *[Kafka: The Definitive Guide](https://www.oreilly.com/library/view/kafka-the-definitive/9781492043072/)*,
  2nd ed. (O'Reilly Media, 2021), chap. 4, "Kafka Consumers: Reading Data from
  Kafka." Goes through consumer groups and rebalances, automatic and manual
  commits, and how a consumer starts from a specific offset.

# Splitting a log into partitions

> How a log is divided by key so that several processors share the work, what order survives the split, and what partitions cannot do.

Source: https://stream-processing-systems.github.io/en/course/distribution/splitting-a-log-into-partitions/

The usage records of our AI assistant now go to a
[log](https://stream-processing-systems.github.io/en/course/distribution/a-queue-or-a-log.md): the gateway appends them, and readers keep their
own positions. Three processors, A, B, and C, are ready to count them. If they
take records in turn, `acme`'s records are scattered among them: no processor
knows the account's whole total, the email at 1,500 tokens comes at the wrong
moment, and a copy of `u-102` can be counted twice.

All records of one account have to reach one processor. So the company divides
the log by account into three parts, one for each processor. How should a
record's part be chosen, what happens to the order of records, and what does a
processor save in its checkpoint when it reads only one part?

## Dividing the log by key

Each part of a divided log is called a **partition**. A partition is a log of
its own: records are appended to its end, it numbers its own positions, and it
keeps records after they are read. The usage log now has partitions 0, 1, and
2. Processor A reads partition 0, B reads 1, and C reads 2.

The gateway chooses the partition for each record by its
[key](https://stream-processing-systems.github.io/en/course/fundamentals/grouping-events-by-key.md), the account. It computes a
number from the account ID, called a **hash**, and takes the remainder after
dividing it by the number of partitions. The same ID always gives the same
hash, so all records of one account go to the same partition. Kafka's producer
works this way when a record has a key.[^1] Suppose the rule gives:

| Account | Partition | Processor |
| --- | --- | --- |
| `acme` | 0 | A |
| `beta` | 1 | B |
| `gamma` | 2 | C |
| `delta` | 0 | A |

Processor A keeps the state of `acme` and `delta`, each account in its own
row. Sharing a partition does not mix their totals: the key still decides which
row a record changes. A partition only decides which processor holds that row.

![Dividing the log by key](diagrams/keys-partition-and-state.svg)

Here is the beginning of partition 0 on the morning of February 2:

| Position | Record | Account | Tokens |
| --- | --- | --- | --- |
| 1 | `u-101` | `acme` | 1,000 |
| 2 | `u-102` | `acme` | 400 |
| 3 | `u-105` | `delta` | 300 |
| 4 | `u-102`, sent again | `acme` | 400 |
| 5 | `u-103` | `acme` | 600 |

Everything that went wrong with the queue works again. Processor A sees every
record of `acme`, so it knows the whole total. It notices the moment the
account crosses 1,500 tokens, at `u-103`, and sends the email then. The copy of
`u-102` has the same key as the original, so it lands in the same partition,
and A recognizes its ID. Meanwhile, B and C count their own accounts, and none
of the three waits for the others.

## Order within a partition

A partition keeps its records in the order they were appended, and every
reader reads them in that order.[^2] Across partitions there is no common
order. A record that `beta` sent after `u-103` sits in partition 1, and B may
read it before or after A reads `u-103`, depending on how fast each
processor goes.

For our totals, this does not matter. Each total depends on the records of one
account, and those are all in one partition, in one order. It matters for a
result that combines accounts, such as the number of tokens the whole service
used per minute. Such a result reads all partitions, and they progress at
different speeds, just like the
[separate inputs of a watermark](https://stream-processing-systems.github.io/en/course/time/how-far-has-the-stream-progressed.md).

The order within a partition is the order of appending, which is not always
the order of events. The copy of `u-102` sits after `u-105` because the
gateway sent it again, not because the request happened later. A record
delayed on its way to the log is appended late too. The partition keeps the
order in which records arrived, and
[event time](https://stream-processing-systems.github.io/en/course/time/event-time-and-processing-time.md) is still the way to
tell when things happened.

## Progress for each partition

A processor's [reading progress](https://stream-processing-systems.github.io/en/course/reliability/what-must-survive-a-restart.md)
used to be one position in one log. Now each partition has its own numbering,
so progress is a position in each partition that the processor reads. Position
4 in partition 0 and position 4 in partition 1 have nothing to do with each
other.

Processor A's checkpoint now looks like this: `acme` 1,400 tokens with its
counted IDs, `delta` 300 tokens, and the next position 4 in partition 0. It
holds the state of every key in partition 0 and the position in that
partition, and nothing about the other partitions. A processor that reads two
partitions saves two positions. The rule of a
[consistent checkpoint](https://stream-processing-systems.github.io/en/course/reliability/recovering-a-consistent-computation.md)
still applies to each of them: the state includes exactly the records before
the saved position in each partition.

## Moving a partition to another processor

At 11:00, the machine of processor A fails. B can take over partition 0, but
the partition alone is not enough. B starts with no state for `acme` and
`delta`. If it simply read on from where A stopped, `acme`'s total would start
from zero.

So B restores what A saved: the state of partition 0's keys and the position
in partition 0, taken from A's last checkpoint. Then it replays the records
from that position. This works only if A's checkpoint is stored where B can
reach it, and if, in our model, the state is saved per partition, so that B
can take the part it needs without the rest. Engines such as Flink also move
state together with the responsibility for keys. Flink, though, divides its
keyed state into groups of keys of its own, which do not match the partitions
of the input log, and restores the state and the input positions together from
a checkpoint.[^3]

B also has to be sure that A has really stopped. If A was only slow to answer
and keeps running, both processors count partition 0 and both send results.
The failed processor must stop acting on the partition before another one
takes it over.

![Moving a partition to another processor](diagrams/partition-state-transfer.svg)

## What partitions cannot do

Partitions divide the work between keys, never within one key. That has three
consequences.

The number of partitions limits the number of processors. With three
partitions, a fourth processor has nothing to read. To prepare for growth, a
log can be split into more partitions than there are processors at first, with
each processor reading several of them.

One busy key stays in one partition. Suppose `acme` alone sends 2,500 records
a second. All of them go to partition 0, and A, which counts 2,000 a second,
falls behind, while B and C sit half idle. Adding processors does not help,
because one processor reads the whole partition. Splitting `acme`'s work would
mean a different computation, for example partial totals combined later, with
the problems of the queue to solve again.

Changing the number of partitions moves keys. The remainder after dividing by
four is not the remainder after dividing by three, so with a fourth partition,
`acme`'s new records may go to partition 3. Its old records and its state stay
behind with partition 0. Kafka, for example, does not move existing records
when partitions are added, and records with the same key may go to a different
partition after that.[^4] Such a change has to be planned together with the
state, much like moving a partition from one processor to another.

Moving a partition also needs someone to decide. When A failed, something had
to notice it, choose B, and tell B which partition to take and where A's
progress was saved. With three processors, a person could do it. At 3:00 in
the morning, with dozens of processors and partitions, someone has to do it
automatically, and every processor has to agree on who reads what.

## What to remember

- A partition is one part of a divided log, with its own order and its own
  positions. The producer chooses it from the record's key, so all records of
  one key share a partition.
- A partition keeps the order of appending. Different partitions have no
  common order, and appending order is not event order.
- Reading progress is a position in each partition, and a checkpoint keeps the
  state of a partition's keys together with that position.
- In our model, a partition moves to another processor only with the state of
  its keys, and only after the old processor has stopped. Partitions cannot split one busy key, and
  changing their number moves keys.

## References

[^1]: [Apache Kafka 4.4: Producer Configs, partitioner.class](https://kafka.apache.org/44/configuration/producer-configs/).
[^2]: [Apache Kafka 4.4: Introduction, Main Concepts and Terminology](https://kafka.apache.org/44/getting-started/introduction/).
[^3]: [Apache Flink 2.3: Keyed State](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/stateful-stream-processing/#keyed-state).
[^4]: [Apache Kafka 4.4: Basic Kafka Operations, Modifying topics](https://kafka.apache.org/44/operations/basic-kafka-operations/).

## Further reading

- Martin Kleppmann and Chris Riccomini, *[Designing Data-Intensive Applications](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781098119058/)*,
  2nd ed. (O'Reilly Media, 2026), chap. 12, "Stream Processing." Shows why a
  log divided into partitions gives each reader whole partitions instead of
  single messages, what that does to ordering, and why the number of
  partitions caps the number of readers.

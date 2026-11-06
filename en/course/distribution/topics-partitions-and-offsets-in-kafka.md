# Topics, partitions, and offsets in Kafka

> How Kafka names the parts of a partitioned log: topics, brokers, records with keys, and offsets, and why an offset is a record's address rather than the event's identity.

Source: https://stream-processing-systems.github.io/en/course/distribution/topics-partitions-and-offsets-in-kafka/

The usage log of our AI assistant is
[split into partitions](https://stream-processing-systems.github.io/en/course/distribution/splitting-a-log-into-partitions.md), and three
processors share them. The company did not build that log itself. It runs it
on Apache Kafka, which also decides which processor reads which partition and
keeps track of where each one stopped.

To understand how Kafka distributes the work, we first need to connect its
terms with our model: how topics, brokers, records, and offsets fit together.
What does the usage log look like in Kafka, and how does a consumer find its
place in it?

## Topics and brokers

In Kafka, a named log is called a **topic**. Ours is called `usage`. A topic is
divided into partitions, exactly as in our model: each partition keeps its
records in the order they were appended, and records with the same key go to
the same partition.[^1] The `usage` topic has three partitions, 0, 1, and 2.

Kafka runs on several servers. The servers that store the partitions and serve
them to producers and consumers are called **brokers**.[^1] The partitions of
one topic are spread across different brokers, so writing and reading are
shared among machines too. Kafka also keeps copies of each partition on other
brokers, so that the failure of one broker does not take its partitions with
it. A common setting is three copies.[^1]

The gateway and the processors connect to the brokers. The gateway is a
producer that writes to the `usage` topic, and each processor is a consumer
that reads from it.

## A record: key, value, and timestamp

A Kafka record has a key, a value, a timestamp, and optional headers with
extra information.[^1] For our gateway, the key is the account ID, and the
value is the usage record we already know, with one more field: `status`
tells whether the request succeeded.

```json
{
  "usage_id": "u-103",
  "account_id": "acme",
  "tokens": 600,
  "status": "succeeded",
  "occurred_at": "2026-02-02T06:03:00Z"
}
```

Here is how the gateway sends it, using Kafka's Java client:

```java
producer.send(new ProducerRecord<>("usage", "acme", usageJson));
```

The three arguments are the topic, the key, and the value. The code does not
name a partition. The producer computes it from the hash of the key, `acme`,
so every record of the account lands in the same partition.[^2]

The timestamp is not necessarily the time of the event. By default, Kafka
takes the time when the producer created the record; a topic can instead use
the time when the broker appended it.[^3] Both are close to the time of the
request when everything goes smoothly and far from it when a record is
delayed. That is why the value carries `occurred_at`, and our processor counts
by [event time](https://stream-processing-systems.github.io/en/course/time/event-time-and-processing-time.md) from there.

## Offsets

The position of a record in a partition is called its **offset**. Kafka
numbers each partition from 0, and an offset identifies a record within its
partition.[^4] So the positions 1 to 5 of partition 0 in our model become
offsets 0 to 4:

| Offset | Key | Record | Tokens |
| --- | --- | --- | --- |
| 0 | `acme` | `u-101` | 1,000 |
| 1 | `acme` | `u-102` | 400 |
| 2 | `delta` | `u-105` | 300 |
| 3 | `acme` | `u-102`, sent again | 400 |
| 4 | `acme` | `u-103` | 600 |

An offset means something only together with its partition. Partition 1 has an
offset 2 as well, and it is a different record. The full address of `u-103` is
the topic, the partition, and the offset: `usage`, 0, 4.

A consumer's reading progress is an offset too: the offset of the next record
it will receive. A consumer at offset 3 in partition 0 has received the records
at offsets 0 to 2 and will receive the copy of `u-102` next.[^4] Here is a
processor reading the topic and printing each record's address:

```java
consumer.subscribe(List.of("usage"));
while (true) {
    for (ConsumerRecord<String, String> record : consumer.poll(Duration.ofSeconds(1))) {
        System.out.println(record.partition() + " " + record.offset() + " " + record.key());
    }
}
```

Each call to `poll` returns a batch of records from the consumer's current
positions and moves those positions past the returned records.[^4] For a
consumer that lags behind, the batch holds records written long ago. Nothing is removed from the
partition: another consumer can read the same records from its own position.

![Offsets and reading progress](diagrams/next-consumer-offset.svg)

## An offset is not an event ID

The original `u-102` and its copy have different offsets, 1 and 3, so comparing
offsets would not catch the repeat. The processor still uses `usage_id` for
[deduplication](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md).

Kafka does prevent some copies itself. The lost acknowledgement from our
gateway's story can happen between the producer and the broker as well: the
broker stores a record, its reply is lost, and the producer sends the record
again. For this case, the broker gives each producer an ID and recognizes a
repeated send by its sequence number, so the retry does not add a second
record to the partition.[^5] This **idempotent producer** is on by default,
unless other settings conflict with it.[^2]

It covers only the client's own retries of one send. If the application calls
`send` again for the same record, Kafka sees a new record, and the Java client
documentation says so directly: resends by the application are not
covered.[^6] This happens, for example, when the gateway restarts after the
broker stored `u-102` and the new gateway process sends the record again.
The copy then gets its own offset, and only the `usage_id` shows that it is a
copy. So the processor keeps its list of counted IDs, while the idempotent
producer saves it some of the work.

## Where a consumer's position lives

The position that `poll` moves forward lives in the consumer's memory. At
11:00, when processor A's machine fails, its position in partition 0 is gone
with it. Partition 0 needs a new reader, and that reader needs a position to
start from. Someone has to notice that A has stopped, choose which processor
takes partition 0, and give it an offset that matches the state it restores.
Kafka detects the failure, reassigns the partition, and stores offsets that
consumers save. How does the new reader recover the matching totals and
counted IDs?

## What to remember

- A topic is a named log in Kafka, divided into partitions. Brokers store the
  partitions and keep copies of them on other brokers.
- A record has a key, a value, and a timestamp. The producer chooses the
  partition from the hash of the key; the timestamp is not necessarily the time
  of the event.
- An offset is the position of a record in one partition, numbered from 0. A
  consumer's progress is the offset of the next record it will read.
- An offset is an address, not an event identity. The idempotent producer
  removes copies from the client's own retries; copies sent again by the
  application still need the event's ID.

## References

[^1]: [Apache Kafka 4.4: Introduction, Main Concepts and Terminology](https://kafka.apache.org/44/getting-started/introduction/).
[^2]: [Apache Kafka 4.4: Producer Configs, partitioner.class and enable.idempotence](https://kafka.apache.org/44/configuration/producer-configs/).
[^3]: [Apache Kafka 4.4: Topic Configs, message.timestamp.type](https://kafka.apache.org/44/configuration/topic-configs/).
[^4]: [Apache Kafka 4.4: KafkaConsumer, Offsets and Consumer Position](https://kafka.apache.org/44/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html).
[^5]: [Apache Kafka 4.4: Design, Message Delivery Semantics](https://kafka.apache.org/44/design/design/).
[^6]: [Apache Kafka 4.4: KafkaProducer, idempotence](https://kafka.apache.org/44/javadoc/org/apache/kafka/clients/producer/KafkaProducer.html).

## Further reading

- Gwen Shapira, Todd Palino, Rajini Sivaram, and Krit Petty, *[Kafka: The Definitive Guide](https://www.oreilly.com/library/view/kafka-the-definitive/9781492043072/)*,
  2nd ed. (O'Reilly Media, 2021), chap. 3, "Kafka Producers: Writing Messages
  to Kafka." Shows how a producer chooses a partition, waits for the broker's
  acknowledgement, and retries, and when the idempotent producer keeps those
  retries from creating copies.

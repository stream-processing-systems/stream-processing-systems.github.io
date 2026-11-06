# Stream Processing

> A course on stream processing.

Read the articles in order: each one builds on the ones before it. Each link is the Markdown text of one article. The course is still being written, and new articles are added at the end.

## Introduction

1. [Why stream processing?](https://stream-processing-systems.github.io/en/course/introduction/why-stream-processing.md): When to compute an answer on request, on a schedule, or as each change arrives.

## Fundamentals

2. [What does an event tell us?](https://stream-processing-systems.github.io/en/course/fundamentals/what-does-an-event-tell-us.md): What a useful event record contains, and how an event differs from a command and the current state.
3. [From events to results](https://stream-processing-systems.github.io/en/course/fundamentals/from-events-to-results.md): How a source, a filter, a transformation, and a sink turn mixed events into one result.
4. [When one event is not enough](https://stream-processing-systems.github.io/en/course/fundamentals/when-one-event-is-not-enough.md): Why some results depend on earlier events, and what a processor keeps between them.
5. [Grouping events by key](https://stream-processing-systems.github.io/en/course/fundamentals/grouping-events-by-key.md): How a key keeps each order's memory apart when events from many orders arrive mixed together.

## Time and windows

6. [Event time and processing time](https://stream-processing-systems.github.io/en/course/time/event-time-and-processing-time.md): Why a record has two times, when it happened and when it was processed, and how to choose between them.
7. [Putting events into time windows](https://stream-processing-systems.github.io/en/course/time/putting-events-into-time-windows.md): How a processor splits an endless stream into time periods and keeps a separate result for each.
8. [Sliding and session windows](https://stream-processing-systems.github.io/en/course/time/sliding-and-session-windows.md): Windows that overlap, windows shaped by the data itself, and what a late record does to each.
9. [How far has the stream progressed?](https://stream-processing-systems.github.io/en/course/time/how-far-has-the-stream-progressed.md): What a watermark tells a processor about event-time progress, and why it is an estimate.
10. [When is a window result ready?](https://stream-processing-systems.github.io/en/course/time/when-is-a-window-result-ready.md): When a window publishes results, how long it accepts corrections, and how the receiver reads several versions of one result.

## Duplicates, loss, and recovery

11. [When an event arrives twice or never](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md): Why a missing acknowledgement makes a sender repeat a record, how a processor recognizes the copy by its event ID, and why removing copies cannot bring back a lost record.
12. [What must survive a restart?](https://stream-processing-systems.github.io/en/course/reliability/what-must-survive-a-restart.md): What a stream processor needs to continue after a restart: input it can read again, its state, how far it has read, and the results it has already sent.
13. [Recovering a consistent computation](https://stream-processing-systems.github.io/en/course/reliability/recovering-a-consistent-computation.md): Why a checkpoint must save state and reading position for the same moment, why only a completed checkpoint can be trusted, and what replay assumes about the computation.
14. [One result, one external effect?](https://stream-processing-systems.github.io/en/course/reliability/one-result-one-external-effect.md): Why recovery cannot undo a result another system has received, and how idempotent receivers, versions, and transactions make each result take effect once.

## Distributed processing and the log

15. [A queue or a log?](https://stream-processing-systems.github.io/en/course/distribution/a-queue-or-a-log.md): How storage between a producer and a consumer lets each work at its own pace, how a queue hands records to workers and removes them, and how a log keeps them for every reader.
16. [Splitting a log into partitions](https://stream-processing-systems.github.io/en/course/distribution/splitting-a-log-into-partitions.md): How a log is divided by key so that several processors share the work, what order survives the split, and what partitions cannot do.
17. [Topics, partitions, and offsets in Kafka](https://stream-processing-systems.github.io/en/course/distribution/topics-partitions-and-offsets-in-kafka.md): How Kafka names the parts of a partitioned log: topics, brokers, records with keys, and offsets, and why an offset is a record's address rather than the event's identity.
18. [Consumer groups and replay in Kafka](https://stream-processing-systems.github.io/en/course/distribution/consumer-groups-and-replay-in-kafka.md): How Kafka shares partitions among the consumers of a group and moves them when one fails, why a committed offset needs matching state, and how independent groups read the same history and read it again.
19. [How long does Kafka keep history?](https://stream-processing-systems.github.io/en/course/distribution/how-long-does-kafka-keep-history.md): How retention decides how far back a log can be read, why copies on several brokers protect against a different failure, and when keeping only the latest value of each key is enough.
20. [Capturing changes from a database](https://stream-processing-systems.github.io/en/course/distribution/capturing-changes-from-a-database.md): Why reading a table again and again misses changes, how change data capture reads the changes a database already records, how a snapshot joins the changes without a gap, and what a row change does not say.

# A queue or a log?

> How storage between a producer and a consumer lets each work at its own pace, how a queue hands records to workers and removes them, and how a log keeps them for every reader.

Source: https://stream-processing-systems.github.io/en/course/distribution/a-queue-or-a-log/

At 09:00 on February 2, the working day begins for most customers of our
[AI assistant](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md), and
requests pour in. The gateway writes 3,000 usage records a second to the
[input history](https://stream-processing-systems.github.io/en/course/reliability/what-must-survive-a-restart.md). The usage
processor counts 2,000 a second. Every second, another 1,000 records are left
waiting, and the totals on the usage page fall further behind.

One processor is not enough, so the company starts two more. Three processors
can share the work only if the results stay right: `acme` is billed for each
request once, its usage page shows its whole total, and the email at 1,500
tokens is sent once, when the account actually crosses 1,500. How should the
records be handed out to the processors?

## A writer that does not wait for the reader

The gateway, at least, is not slowed down. It does not hand records to the
processor directly. It writes them to the history and waits only until the
history has stored each one. How fast the processor reads is not the gateway's
concern: it keeps accepting requests at 3,000 a second, and no record is lost
while the processor lags.

A program that writes records to such storage is called a **producer**, and a
program that reads them is a **consumer**. The gateway is a producer, and the
usage processor is a consumer. Storage between them lets each work at its own
pace, and either can stop for a while without stopping the other.

Storage does not make the consumer faster, though. After an hour at these
rates, the gateway has written 10.8 million records, and the processor has
read 7.2 million. The record it is reading now was written 20 minutes ago, so
the usage page shows totals as of 20 minutes ago, and the gap keeps growing. The
processor can catch up in the evening, when requests slow down, but only if it
keeps up with the input over the whole day and the storage has room for
everything that waits.

![A writer that does not wait for the reader](diagrams/buffer-and-processing-rate.svg)

## A queue: whoever is free takes the next record

A common way to share work among several workers is a **queue**. Records wait
in it in the order they arrive, and each one goes to one of the workers: to the
next in turn or to the next one that is free.[^1] When a worker has finished
with a record, it acknowledges it, and the queue removes the record. If a
worker fails before acknowledging, the queue gives the record to another
worker.[^2]

Here is how a queue might hand out `acme`'s records among processors A, B,
and C:

| Record | Tokens | Processor | That processor's total for `acme` |
| --- | --- | --- | --- |
| `u-101` | 1,000 | A | 1,000 |
| `u-102` | 400 | B | 400 |
| `u-103` | 600 | C | 600 |
| `u-104` | 500 | A | 1,500 |

The work is shared, and so is `acme`'s
[state](https://stream-processing-systems.github.io/en/course/fundamentals/when-one-event-is-not-enough.md). The account has used
2,500 tokens, but no processor knows that. To show the total, the usage page
would have to add up three partial totals. The email goes wrong: the account
crossed 1,500 tokens with `u-103`, when no processor had more than 1,000.
Processor A reaches 1,500 at `u-104`, but that is only its own share, and an
email based on it would come late and by coincidence.

[Deduplication](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md) breaks
too. Suppose the gateway sends `u-102` again because the acknowledgement was
lost. This time the queue gives it to processor C, while B handled the original.
Each keeps its own list of counted IDs, so C does not recognize `u-102` and
adds another 400 tokens to `acme`'s usage.

The queue also removes each record once it is acknowledged. A processor that
restarts from a [checkpoint](https://stream-processing-systems.github.io/en/course/reliability/what-must-survive-a-restart.md)
cannot replay the records it acknowledged after that checkpoint, because the
queue no longer has them. And other readers miss them too. The finance team
reads each month's records to compare the totals with the billing system. To
read them from a queue, the team needs its own queue with its own copy of every
record, set up before the records arrive. A reader added in the middle of the
month cannot get the records from its beginning.

None of this makes a queue a bad tool. It suits tasks that do not depend on
each other. The emails from our [outbox](https://stream-processing-systems.github.io/en/course/reliability/one-result-one-external-effect.md)
are such tasks: any sender can send any email, and once it is sent, nobody
needs it again. A usage record is different. It changes an account's state,
which other records of the same account change too.

## A log: records stay, readers keep their place

Our input history works differently. Storage that appends each record to the
end, numbers the positions, and keeps the records after they are read is
called a **log**. Reading does not change a log. Each reader keeps only its own
[reading progress](https://stream-processing-systems.github.io/en/course/reliability/what-must-survive-a-restart.md), the position
of the next record to read.

Apache Kafka, an open-source system that stores streams of records as logs and
is widely used for this job, works this way. Records are not deleted when they
are read; how long they are kept is set separately, and producers and consumers
know nothing of each other.[^3] Many messaging systems track which records each
reader has finished and delete them. A Kafka reader reads in order, so its
progress is a single number, the position it has reached.[^4]

The finance team now needs no copy. Its reader starts at the first record of
February and reads at its own pace, while the usage processor reads the
newest records. Neither affects the other: the processor's progress does not
remove anything that the finance reader has not yet reached. A reader added
next week can start from the beginning of the month as well, as long as the log
still holds those records.

![Readers keep their own positions](diagrams/independent-log-readers.svg)

Here is how the two compare:

| | Queue | Log |
| --- | --- | --- |
| Reading a record | The worker takes it; once acknowledged, it is removed | The reader moves its position; the record stays |
| Who gets a record | One of the workers | Every reader of the log |
| Another purpose | Needs its own copy of every record | Reads the same log from its own position |
| After a failure | Unacknowledged records go to another worker; acknowledged ones are gone | The reader returns to a saved position and reads again |
| Suits | Independent tasks, such as sending emails | A history that several readers read in order, such as usage records |

Some products offer both ways of reading, so the choice is between the two
contracts more than between products. What decides it is whether records
depend on each other and whether anyone will need them again.

## Three processors on one log

With a log, how do processors A, B, and C share the work? If each of them
reads the whole log, each counts every account, and three processors do the
work of one three times over. If they take positions in turn, A taking 1, 4,
7, and so on, `acme`'s records are split among them exactly as in the queue.
The partial totals, the missing email, and the copy of `u-102` counted twice
all come back.

All of `acme`'s records must go to one processor, which keeps the account's
whole state, while `beta`'s records may go to another. The account is the
[key](https://stream-processing-systems.github.io/en/course/fundamentals/grouping-events-by-key.md) of these records, so the log
has to be divided by key. But a log is one numbered
sequence, and a processor's progress is one position in it. How can it be
divided so that each part keeps its own order, and what does a checkpoint save
when a processor reads only one part?

## What to remember

- Storage between a producer and a consumer lets each work at its own pace.
  It gives a slow consumer time to catch up but does not make it faster.
- A queue hands each record to one worker and removes it once acknowledged. It
  suits independent tasks; records that change shared state get scattered, and
  nothing is left to read again.
- A log keeps records after they are read, and each reader keeps its own
  position. Several readers read the same history independently, and a reader
  can go back.
- Several processors on one log share the work correctly only if all records
  of one key go to the same processor.

## References

[^1]: [RabbitMQ: Work Queues, Round-robin dispatching and Fair dispatch](https://www.rabbitmq.com/tutorials/tutorial-two-python).
[^2]: [RabbitMQ: Consumer Acknowledgements and Publisher Confirms, Automatic Requeueing](https://www.rabbitmq.com/docs/confirms).
[^3]: [Apache Kafka 4.4: Introduction, Main Concepts and Terminology](https://kafka.apache.org/44/getting-started/introduction/).
[^4]: [Apache Kafka 4.4: Design, Consumer Position](https://kafka.apache.org/44/design/design/).

## Further reading

- Martin Kleppmann and Chris Riccomini, *[Designing Data-Intensive Applications](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781098119058/)*,
  2nd ed. (O'Reilly Media, 2026), chap. 12, "Stream Processing." Compares
  message brokers that delete a message once it is acknowledged with brokers
  built on a log, and explains why a log lets readers come back to old
  messages and new readers start from the past.

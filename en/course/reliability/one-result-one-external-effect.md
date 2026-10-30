# One result, one external effect?

> Why recovery cannot undo a result another system has received, and how idempotent receivers, versions, and transactions make each result take effect once.

Source: https://stream-processing-systems.github.io/en/course/reliability/one-result-one-external-effect/

The usage processor of our AI assistant can
[recover its own state](https://stream-processing-systems.github.io/en/course/reliability/recovering-a-consistent-computation.md) after a
failure. It also sends results to other systems. For every counted request,
it writes an entry to the billing system: account, usage ID, and tokens. At the
end of the month, the billing system adds up the entries of each account and
charges the customer. The processor also sends each new total to the usage
page and emails the customer when usage crosses 1,500 tokens.

At 06:03 on February 2, the processor writes the entry for `u-103`, 600
tokens for `acme`. The billing system stores it. Then the machine fails. The
processor restarts from the 06:01 checkpoint, reads `u-103` again, and writes
the entry again. The billing system now holds 600 extra tokens for `acme`, and
the customer will pay for them. How can a result that the processor may send
more than once take effect only once?

## Why recovery cannot undo an effect

The entry for `u-103` is now part of the billing system's data. Restoring the
processor's checkpoint does not reach into another system, so the entry stays.

The processor could stop sending results it may have sent before. That brings
back the opposite failure. If the machine failed before the entry reached the
billing system, nobody would ever write it, and 600 tokens would go unbilled.
The processor is now in the gateway's position from our
[lost acknowledgement](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md): it cannot
know whether the receiver got the write. On its own, it can only choose
between possible copies and possible loss.

So the receiver has to take part. Flink, for example, gives its exactly-once
guarantee from input to output only when the input can be read again and the
receiving system is either idempotent or transactional.[^1] Our input history
can be read again, so what remains is the receivers.

## A receiver that recognizes repeats

The billing system can store each entry together with its usage ID and accept
at most one entry per ID. When the second write of `u-103` arrives, the system
finds the existing entry and replies as it did the first time. The total for
`acme` does not change. Writing the same entry twice now has the same effect as
writing it once: the write is idempotent. This is the
[deduplication](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md) from the processor,
moved to the receiver.

It works under a few conditions:

- The key comes from the input. The usage ID is the same in every replay.
  If the processor created a new random ID for each write, the second write
  would look new.
- Checking and storing are one step. If two attempts arrive at the same
  moment, both must not find "no entry yet" and both insert one. A database can
  enforce this with a rule that an ID may appear only once.
- A known ID with different content is an error. A write of `u-103` with
  700 tokens cannot be a repeat of the entry with 600, and accepting either one
  silently would hide a mistake.
- The receiver remembers keys as long as repeats can come. Our billing
  system keeps entries for years, so it recognizes a replay from any
  checkpoint.

An ID sent with each attempt of an operation so that the receiver can recognize
repeats is called an **idempotency key**. Stripe accepts such keys. In its API
v1, it saves the result of the first request with a key and returns it for every
retry, and it returns an error if a retry comes with different parameters. Keys
can be removed once they are at least 24 hours old, and a key reused after that
starts a new request.[^2] So a replay can perform the operation again if the
receiver has already removed its key. The key has to outlive every repeat that
the receiver is expected to recognize.

## A repeated result and a new version

The usage page receives totals, not entries. Receiving the same total twice
does no harm: 2,000 replaces 2,000. But replay can move the page backwards.
Suppose the machine failed after `u-104`, when the page already showed 2,500.
The processor restarts from the 06:01 checkpoint, replays `u-103`, and sends
2,000. For a moment, the customer sees usage go down, until the replay reaches
`u-104` and sends 2,500 again.

The page needs to tell an older result from a newer one. As with the
[versions of a window result](https://stream-processing-systems.github.io/en/course/time/when-is-a-window-result-ready.md), each
total carries a version, and the page keeps the highest. A good version here
is the position of the last record that the total includes: 2,000 is the total
as of position 3, and 2,500 is the total as of position 4. When the replayed
2,000 arrives, the page already has version 4 and ignores it. A counter that starts
from zero after every restart would lose its place: the page would reject new
totals as old until the counter caught up. A counter saved in the checkpoint
would work, as long as the replay produces the same sequence of totals. The
position needs no extra care, because it already comes from the checkpoint and
the input history.

![The page keeps the highest version](diagrams/versions-on-the-page.svg)

Entries and totals call for different rules. Two entries with the same ID are
the same contribution, and the receiver keeps one. Two totals for the same
account are versions, and the receiver keeps the newer one. A receiver that
dropped the second total as a copy would never show 2,500.

## Results that appear with the checkpoint

There is another way to keep the receiver from seeing a result twice: show
nothing until the checkpoint that includes it is complete. The processor writes
the entries into the billing database inside a **transaction**, a group of
changes that becomes visible all at once or not at all. When the checkpoint
completes, the processor commits the transaction, and the entries appear.

A failure can come at two moments, and they need different handling:

| Failure | Checkpoint | What happens after the restart |
| --- | --- | --- |
| Before the checkpoint completes | Not used for recovery | The transaction is discarded, and the replay writes the same entries into a new one |
| After the checkpoint completes, before or during the commit | Restored | The replay starts after these entries, so the processor commits the old transaction instead of writing them again |

The second row is the subtle one. The restored checkpoint already includes
`u-103`, so the replay will not produce its entry again. The open transaction
is the only place where that entry exists. So the checkpoint has to record
which transaction belongs to it, and the restarted processor has to find that
transaction and commit it. If the first commit went through and only its reply
was lost, committing again must change nothing.

This scheme is called a **two-phase commit**. In the first phase, the processor
writes the entries into a transaction and records that transaction in the
checkpoint. In the second, after the checkpoint completes, it commits the
transaction. Flink describes its exactly-once writes to external systems the
same way.[^3]

This requires a receiver that supports such transactions: they stay open
until the checkpoint completes, survive a restart of the processor, and can be
committed by the restarted one. It also adds delay, because results appear
only when a checkpoint completes. With checkpoints started every minute, an
entry can wait almost a minute for the next checkpoint, plus the time to
complete it and commit. For billing at the end of the month that is fine; for
a live page it may not be.

## Effects that cannot be taken back

The email service is the hardest receiver. Suppose it neither recognizes
repeats nor supports transactions. If the processor sends the email again
during replay, the customer gets two. If it does not, the email may never
arrive.

Some email services accept an idempotency key, and a key like
`acme-2026-02-1500` would turn the email into an idempotent write. Without one,
the processor can write "send an email to `acme` about 1,500 tokens in February"
into a table that recognizes repeats, the same way as billing entries. A
separate sender then reads the table, sends each email, and marks it as sent. A
table of messages waiting to be sent is called an **outbox**.[^4] A failure
between sending and marking can still produce a second email, but only in that
short moment and never from a replay.

For a usage notice, a rare second email is acceptable. For a charge, it is not,
which is why the billing system recognizes usage IDs.

All of this relies on the input history: the gateway writes records there, and
the processor reads them at its own pace and reads them again after a restart.
So far, one processor reads all of it. The assistant serves thousands of
accounts, and one processor may not keep up. Several processors could share
the work, but then they share the history too. Who reads which records, and how
does each processor know where it stopped?

## What to remember

- Restoring a processor does not undo effects in other systems. Without help
  from the receiver, the processor can only choose between possible copies and
  possible loss.
- An idempotent receiver recognizes a repeated write by a key from the input,
  checks and stores in one step, and keeps keys as long as repeats can come.
- Totals are versions. The receiver keeps the newest, judged by a version that
  survives restarts, such as the reading position.
- A transactional receiver shows results only after the checkpoint that
  includes them completes, which adds delay. An effect that supports neither
  leaves a choice between a rare copy and a rare loss.

## References

[^1]: [Apache Flink 2.3: Exactly Once End-to-end](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/learn-flink/fault_tolerance/#exactly-once-end-to-end).
[^2]: [Stripe API: Idempotent requests](https://docs.stripe.com/api/idempotent_requests).
[^3]: [Apache Flink: An Overview of End-to-End Exactly-Once Processing in Apache Flink](https://flink.apache.org/2018/02/28/an-overview-of-end-to-end-exactly-once-processing-in-apache-flink-with-apache-kafka-too/).
[^4]: [Chris Richardson, Microservices.io: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html).

## Further reading

- Fabian Hueske and Vasiliki Kalavri, *[Stream Processing with Apache Flink](https://www.oreilly.com/library/view/stream-processing-with/9781491974285/)*
  (O'Reilly Media, 2019), chap. 8, "Reading from and Writing to External
  Systems." Compares idempotent and transactional writes, shows why a reader can
  see a result jump back during recovery, and explains why transactional writes
  delay results until a checkpoint completes.

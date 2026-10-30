# What must survive a restart?

> What a stream processor needs to continue after a restart: input it can read again, its state, how far it has read, and the results it has already sent.

Source: https://stream-processing-systems.github.io/en/course/reliability/what-must-survive-a-restart/

At 06:05 on February 2, the usage processor of our
[AI assistant](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md) restarts after an
update. Before the restart, it had counted three requests from account `acme`,
2,000 tokens in total, and remembered their usage IDs. The new process starts
with empty memory. The next record, `u-104` for 500 tokens, makes the total
500. The customer's usage page drops from 2,000 to 500, and at the end of the
month the bill will drop with it.

"Save the data" is the obvious answer, but which data? Before the restart, the
processor had the records it received, the total and the list of counted IDs,
a sense of which records it had already handled, the totals it had sent to the
usage page, and the emails it had sent to the customer. Each of these plays its own part in a restart. What must
survive, and what for?

## Input that can be read again

The first idea is to compute the total again from the records. In our setup,
that is impossible: the gateway forgets each record as soon as the processor
acknowledges it. Once the processor's memory is gone, no one can give it those
records again.

So we change the setup. The gateway now writes each record to storage that
keeps records in the order they arrive and numbers their positions: `u-101` is
at position 1, `u-102` at 2, `u-103` at 3, and `u-104` at 4. The processor
reads from there in order. A record stays in storage after the processor reads
it, so this storage holds the **input history**.

With the history, a restarted processor can read from position 1 and arrive at
the correct total: 1,000 + 400 + 600 + 500 = 2,500. On February 2 that takes a
moment. On February 28, it means rereading a month of records from every
account before the usage page shows anything again. And storage does not keep
records forever: if the history holds only the last week, a total for the month
cannot be computed from it at all.

## Saving the state

Instead of recomputing the state, the processor can save it from time to time.
While it runs, it works with its **working state**, the copy in memory that
changes with every record. The saved copy matters only after a failure.

So the question is which failure it should survive. A copy on the processor's
local disk survives a process crash or a restart after an update. It is gone
if the machine itself fails. A copy stored on another machine survives that
too, as long as it was written completely and the new process can reach it.
"Saved to disk" does not answer either question.

A saved copy of the state from which a processor can restart is called a
**checkpoint**.[^1] What goes into it depends on the computation. Our usage
processor needs the total for each account and the list of counted IDs with
their token counts. The total alone is not enough: restored without the list,
it would let the next
copy of `u-102` be counted again. A window computation like the
[supervisor's count](https://stream-processing-systems.github.io/en/course/time/when-is-a-window-result-ready.md) needs every open
window with its count and the version number of its last result. A checkpoint
keeps everything that affects the processor's future decisions, which is more
than the number it shows.

## How far the processor has read

Suppose the processor made a checkpoint at 06:01, after `u-102`. The checkpoint
says the total is 1,400. A restarted processor gets 1,400 back, but where in
the history should it continue? The total does not say which records it
includes.

So the checkpoint also keeps the processor's **reading progress**: the
position of the next record to read. Ours says "total 1,400, next position 3."
Flink describes its checkpoints the same way: a position in each input, together
with the state that resulted from processing all records up to that
position.[^1]

Now follow the restart. After the 06:01 checkpoint, the processor counted
`u-103`, and the total reached 2,000. Then it restarted before saving another
checkpoint. The new process restores 1,400 and position 3, reads `u-103` again,
and returns to 2,000. Then it reads `u-104` and reaches 2,500. Reading records
from the history once more, starting from the checkpoint's position, is
called **replay**. A checkpoint and replay work together: the checkpoint spares
the processor from rereading the whole month, and replay fills in what happened
after the checkpoint.[^2]

![Restart from a checkpoint and replay](diagrams/checkpoint-and-replay.svg)

Replay works only while the history still holds the records after the
checkpoint. If storage had already removed position 3, the restored processor
would never see `u-103`. So the history has to keep records at least as far
back as the oldest checkpoint the processor may restart from.

How often to make checkpoints is a tradeoff. Frequent checkpoints mean less
replay after a restart, but writing them takes time and resources. Rare
checkpoints are cheap to make, and a restart then replays longer.[^2] The right
interval depends on how large the state is and how long the usage page may lag
after a restart.

## Results already sent elsewhere

One more kind of data lives outside the processor. While it counted `u-103`,
the processor sent the new total, 2,000, to the usage page. The account's
total also crossed 1,500 tokens, the point at which the customer had asked for
an email, so the processor sent one.

These results now belong to other systems. Restoring the checkpoint returns the
processor to 1,400, but the usage page and the customer's mailbox keep what
they received. During replay, the processor counts `u-103` again and sends the
results again. The usage page receives 2,000 a second time, which does no harm:
a new total [replaces](https://stream-processing-systems.github.io/en/course/time/when-is-a-window-result-ready.md) the old one.
The email is a different story. The customer gets a second message about the
same moment, and no checkpoint can take the first one back.

So each receiver needs its own rule for results that come again.

There is also a subtlety inside the checkpoint. In our example, the total and
the reading position were saved at the same moment. But writing a checkpoint
takes time, and the processor keeps reading meanwhile. If the total is saved
after `u-103` and the position before it, both survive the restart and still
disagree about whether `u-103` was counted. Which one should the restarted
processor believe?

## What to remember

- A restart needs four different things: the input history, the state, the
  reading progress, and knowledge of the results already sent.
- A saved copy protects only against failures it survives, and only if it was
  written completely and the restarted processor can reach it.
- A checkpoint keeps all state that affects future decisions, together with
  the position of the next record to read.
- Replay fills in the records after the checkpoint and requires the history to
  still hold them. Restoring state does not take back results that other
  systems have already received.

## References

[^1]: [Apache Flink 2.3: Fault Tolerance via State Snapshots, Definitions](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/learn-flink/fault_tolerance/#definitions).
[^2]: [Apache Flink 2.3: State Persistence](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/stateful-stream-processing/#state-persistence).

## Further reading

- Tyler Akidau, Slava Chernyak, and Reuven Lax, *[Streaming Systems](https://www.oreilly.com/library/view/streaming-systems/9781491983867/)*
  (O'Reilly Media, 2018), chap. 7, "The Practicalities of Persistent State."
  Explains why a long-running computation cannot count on its input being
  available forever, and how saving intermediate state and the input position
  reduces both repeated work and stored input.
- Josh Fischer and Ning Wang, *[Grokking Streaming Systems](https://www.manning.com/books/grokking-streaming-systems)*
  (Manning, 2022), chap. 10, "Stateful Computation." Separates the data a
  component must restore from temporary data it can drop, and shows on a small
  job how checkpoints are created and where they are stored.

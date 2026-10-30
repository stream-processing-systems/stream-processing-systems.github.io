# Recovering a consistent computation

> Why a checkpoint must save state and reading position for the same moment, why only a completed checkpoint can be trusted, and what replay assumes about the computation.

Source: https://stream-processing-systems.github.io/en/course/reliability/recovering-a-consistent-computation/

The usage processor of our AI assistant can restart from a
[checkpoint](https://stream-processing-systems.github.io/en/course/reliability/what-must-survive-a-restart.md): it restores the state and reads
the input history again from the saved position. The history for account
`acme` holds four records: `u-101` at position 1 with 1,000 tokens, `u-102` at
2 with 400, `u-103` at 3 with 600, and `u-104` at 4 with 500. The correct
total is 2,500.

Writing a checkpoint takes time, and the processor keeps reading meanwhile.
Suppose it saves the state, which holds the total and the list of counted IDs,
in one step and the reading position in another, while `u-103` is being
counted between the two. After a restart, both values come back, but they
describe different moments. Which one is right, and how should a checkpoint be
written so that the question does not come up?

## State and position that disagree

Here are the possible combinations after a restart, depending on which value
was saved before `u-103` was counted and which after:

| Restored state | Restored next position | What the processor does | Final total |
| --- | --- | --- | --- |
| 1,400, IDs up to `u-102` | 3 | Reads `u-103` and `u-104` | 2,500 |
| 2,000, IDs up to `u-103` | 3 | Reads `u-103`, finds its ID, skips it; reads `u-104` | 2,500 |
| 1,400, IDs up to `u-102` | 4 | Never reads `u-103`; reads `u-104` | 1,900 |

The first row is what we want: the state includes exactly the records before
the position. In the second, the state is ahead of the position, and only the
[list of counted IDs](https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never.md) saves the total.
A computation without such a list, like a count of requests per minute, would
count `u-103` twice. In the third, the position is ahead of the state, and
`u-103` is lost. No list of IDs helps here: the processor never sees the record
again.

![State and position that disagree](diagrams/state-and-position.svg)

So the state and the position have to describe the same moment: the state
includes every record before the position and none after it. A checkpoint with
this property is called a **consistent checkpoint**.[^1] It matters for every
part of the state. If the processor kept its list of IDs in one checkpoint and the
totals in another, the two could disagree in the same way.

## Taking a consistent checkpoint

The simplest way to get such a checkpoint is to stop between two records. Our
processor finishes counting `u-102`, stops reading, copies its state together
with the position 3, and continues with `u-103`. Nothing changes the state
while the copy is made, so the copy and the position match. The processor can
then write the copy to storage while it keeps reading.

The pause is short when the state is small. A processor that keeps millions of
accounts in its state would stall for longer, so real engines avoid the pause.
Flink, for example, marks the point of a checkpoint with a special marker in
the input. Each part of the computation saves its state when the marker
reaches it, so the checkpoint includes every record before the marker and none
after it. Processing continues while the saved state is written to
storage.[^2]

## Recovery from a consistent checkpoint

Now follow a failure. At 06:01, the processor saves a checkpoint: total 1,400,
IDs `u-101` and `u-102`, next position 3. It counts `u-103`, and its working
total becomes 2,000. Before the next checkpoint, the machine fails.

The restarted processor restores the checkpoint: 1,400 and position 3. It reads
`u-103` again and reaches 2,000, then `u-104` and 2,500. The processor handled
`u-103` twice, once before the failure and once after. Yet the result
includes its 600 tokens once, because the working total of 2,000 that already
contained them was thrown away with the failed process.

This is what exactly-once means inside a processor. Records after the
checkpoint are processed again, and each of them still affects the restored
state once. Flink states its exactly-once guarantee the same way.[^3] It is
also why a restart from a consistent checkpoint does not need the list of IDs at
all: even a plain count of requests comes out right. The list is still
needed for copies the gateway sends, which have different positions in the
history.

## Only a completed checkpoint counts

Writing a checkpoint is work that can fail too. Suppose the machine fails
while the 06:04 checkpoint is half written. If the restarted processor took
the newest file in storage, it would get half a state: perhaps the totals of
some accounts and not others.

So a checkpoint has to be finished before anyone relies on it. Our processor
writes the copy of the state first. Only when all of it is safely stored does
it record a short note: "checkpoint 06:04 is complete; its state is in this
copy, the total is 2,000, and the next position is 4." A restart looks for the latest note and
ignores copies without one. Until the new note is written, the 06:01
checkpoint stays in storage and remains the one to restart from. Flink works
the same way: after a failure, it restores the latest completed
checkpoint.[^4]

Keeping the previous checkpoint costs storage, and the input history has to
reach back to its position as well. In exchange, there is always one
checkpoint whose state and position are known to be whole.

## What replay assumes

Replaying `u-103` gave the same 600 tokens as before because counting a
record depends only on the record and the state. That is not true of every
computation.

Suppose the processor assigned each record to a month by its own clock instead
of the record's `occurred_at`. A request at 23:59:58 on February 28 is counted
in February. If the processor fails and replays that record after midnight,
the same request lands in March. The two runs disagree because the result
depended on [processing time](https://stream-processing-systems.github.io/en/course/time/event-time-and-processing-time.md),
which is different on every run. The same happens if the processor asks
another service for something that can change, such as the current price per
token, or makes a random choice.

Such a computation can still be recovered correctly if every input to the
decision comes from the record. The month comes from `occurred_at`, which every
replay sees the same. The price can travel in the record too, set by the
gateway when the request finishes. Keeping the price in the processor's state
would not be enough: a price fetched after the last checkpoint is lost with
the rest of the working state, and the replay would fetch it again.

Recovery has now restored the processor's own result, but not what it sent
elsewhere. During the replay, the processor counted `u-103` again
and sent its results again: the total to the usage page and the email about
crossing 1,500 tokens. Suppose it also writes an entry for every counted
request to the billing system, which charges customers at the end of the
month. That system now has two entries for `u-103`. Restoring the checkpoint
did not remove the first one, and the billing system has no way to tell that
the second is a repeat.

## What to remember

- A consistent checkpoint saves state that includes exactly the records
  before its reading position. If either one is ahead, records are counted
  twice or lost.
- The simplest consistent checkpoint is a copy taken between two records.
  Engines get the same result without a long pause.
- Only a completed checkpoint is used for recovery, and the previous one stays
  until the next is complete.
- After recovery, records are processed again and still affect the state once,
  as long as their effect does not depend on the clock or other changing
  inputs. Results already sent outside are not recovered with the state.

## References

[^1]: [Apache Flink 2.3: Fault Tolerance via State Snapshots, Definitions](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/learn-flink/fault_tolerance/#definitions).
[^2]: [Apache Flink 2.3: How does State Snapshotting Work?](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/learn-flink/fault_tolerance/#how-does-state-snapshotting-work).
[^3]: [Apache Flink 2.3: Exactly Once Guarantees](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/learn-flink/fault_tolerance/#exactly-once-guarantees).
[^4]: [Apache Flink 2.3: Recovery](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/stateful-stream-processing/#recovery).

## Further reading

- Fabian Hueske and Vasiliki Kalavri, *[Stream Processing with Apache Flink](https://www.oreilly.com/library/view/stream-processing-with/9781491974285/)*
  (O'Reilly Media, 2019), chap. 3, "The Architecture of Apache Flink." The
  section on checkpoints explains what makes a checkpoint consistent, how an
  application is restored from one, and how Flink takes checkpoints without
  pausing the whole computation.

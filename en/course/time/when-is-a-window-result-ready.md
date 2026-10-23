# When is a window result ready?

> When a window publishes results, how long it accepts corrections, and how the receiver reads several versions of one result.

Source: https://stream-processing-systems.github.io/en/course/time/when-is-a-window-result-ready/

At `store-418`, the supervisor watches packed orders in
[ten-minute windows](https://stream-processing-systems.github.io/en/course/time/putting-events-into-time-windows.md). The count for
`[10:00, 10:10)` reached three only at 10:12, when the last late record
arrived. Shown at 10:10 sharp, it would have said one and suggested a slowdown
that never happened. Waiting until 10:12 would have been better this time, but
the supervisor does not want to stare at an empty screen either.

The packing feed now has a [watermark](https://stream-processing-systems.github.io/en/course/time/how-far-has-the-stream-progressed.md)
that trails the latest event time by one minute. It tells the processor when
the window is probably over. When should the supervisor see a count: before the
watermark passes 10:10, when it passes, or after? And what happens to a record
that arrives after that?

## Three separate decisions

It is tempting to think of a window as something that closes once and then
publishes its result. In fact, three separate decisions are hidden in that
picture:

| Decision | Question | Decided by |
| --- | --- | --- |
| Membership | Which records belong to the window? | Event time and the window's boundaries |
| Publication | When does the window send a result? | A trigger |
| Lifetime | How long does the window accept corrections? | Allowed lateness |

Membership never changes: a packing at 10:09:59 belongs to `[10:00, 10:10)`,
whenever its record arrives. The other two decisions are choices that depend
on what the supervisor needs.

## Results before, at, and after the watermark

The rule that decides when a window sends a result is called a **trigger**.[^1]
A trigger can react to records joining the window, to the watermark, or to the
processor's clock. One window can send several results, and each one says what
the window holds at that moment.

For the supervisor, we choose a trigger that sends three kinds of results:

- **Early**: after each record joins the window, while the watermark is still
  before its end. The count may grow.
- **On time**: once, when the watermark passes the end of the window. The
  processor believes the window is complete.
- **Late**: after each late record, while the window still accepts
  corrections.

Here is how the count for `[10:00, 10:10)` develops:

| Processing time | Record arrives | Watermark | Result for `[10:00, 10:10)` |
| --- | --- | --- | --- |
| 10:03:01 | `ord-1047`, packed 10:03:00 | 10:02 | Version 1, early: 1 |
| 10:10:02 | `ord-1051`, packed 10:10:00 | 10:09 | No change: the record belongs to the next window |
| 10:11:00 | `ord-1042`, packed 10:09:00 | 10:09 | Version 2, early: 2 |
| 10:11:10 | `ord-1055`, packed 10:11:00 | 10:10 | Version 3, on time: 2 |
| 10:12:00 | `ord-1337`, packed 10:09:59 | 10:10 | Version 4, late: 3 |

At 10:10 sharp, the supervisor sees a count of one, but it is marked early, so
it reads as the count so far rather than the store's pace. "Early" refers to
the watermark, not the clock: version 2 is early, though it came at 10:11,
because the watermark had not yet passed 10:10.

The on-time result is not proof of completeness either. It means only that
the watermark passed the end of the window. The record of `ord-1337` was more
than a minute out of order, so it arrived after the on-time result, and
version 4 corrected the count.

## How long a window accepts corrections

To add `ord-1337` at 10:12, the processor needed the window's count, which it
kept after the on-time result. It cannot keep every window forever: each one
takes memory, and the store creates a new window every ten minutes.

So the processor keeps each window for a set amount of event time after its
end. That amount is called **allowed lateness**. We choose five minutes: the
count for `[10:00, 10:10)` accepts late records until the watermark reaches
10:15, and then the processor deletes it. Flink, for example, keeps window
state for the allowed lateness and drops late records by default, when that
lateness is zero.[^2]

![Results and corrections as the watermark moves](diagrams/window-lifetime.svg)

The five minutes are measured by the watermark, not by the processor's clock.
If the feed goes quiet and the watermark stops, the window stays open for
corrections as long as the watermark stands still, however long that takes on
the clock.

A larger allowed lateness lets more late records correct their windows, and it
costs more memory and more corrections that the receiver has to handle.

## Records that come too late

At 10:31, a record arrives: `ord-1063`, packed at 10:14. By then the watermark
has reached 10:28. The count for `[10:10, 10:20)` was deleted when the
watermark reached 10:25, so the processor cannot correct it.

Adding the record to the current window would be wrong: the order was packed
at 10:14, and counting it in a later window would make the report lie about
when the store worked. Dropping it silently would lose an order. Our processor
sends such records to a separate list that staff can review, and Flink can
likewise send records that come too late to a separate output.[^3] If the store
needs exact counts for old periods, it can recount them later from all the
records it has stored.

## Results that replace each other

The supervisor's screen received four results for one window: 1, 2, 2, 3. They
are versions of one count, not four counts. Adding them gives 8, while the
store packed three orders in that window. Each new version replaces the
previous one.[^4]

So every result has to say which count it is a version of. Ours carry the
store and the window, `store-418` and `[10:00, 10:10)`, plus a version number.
The receiver keeps the latest version for each store and window. If version 3
arrives after version 4, the number shows that it is older, and the receiver
ignores it.

A processor could send changes instead of totals: +1, +1, nothing, +1. Then the
receiver adds them up itself, and every change must reach it exactly once, or
the count drifts. Either way works, as long as the processor and the receiver
agree on which one they use.

Session windows need one more piece. When the late reading merged two sessions
of `charger-7` into [one](https://stream-processing-systems.github.io/en/course/time/sliding-and-session-windows.md), the new result
replaced two earlier ones, and those two were for different windows. A version
number for the new session cannot say that, so the processor has to tell the
receiver explicitly which earlier results to remove.

The supervisor's count now has rules for when it appears, how long it can be
corrected, and how to read its versions. All of it rests on one step that we
have not questioned: each `order_packed` record adds one to the count. If the
feed delivers the packing of `ord-1042` twice, say because the connection
dropped and the record was sent again, the count says four. How can the
processor tell a repeated record from a new event?

## What to remember

- Membership, publication, and lifetime are separate decisions: which records
  belong to a window, when it sends a result, and how long it accepts
  corrections.
- A trigger can send early results before the watermark passes the window's
  end, an on-time result when it passes, and late results after it.
- Allowed lateness is measured in event time. Records that come later can go
  to a separate output instead of being lost or counted in the wrong window.
- Several results for one window are versions. The receiver needs to know
  which result each one replaces.

## References

[^1]: [Apache Flink 2.3: Triggers](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/#triggers).
[^2]: [Apache Flink 2.3: Allowed Lateness](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/#allowed-lateness).
[^3]: [Apache Flink 2.3: Getting late data as a side output](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/#getting-late-data-as-a-side-output).
[^4]: [Apache Flink 2.3: Late elements considerations](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/operators/windows/#late-elements-considerations).

## Further reading

- Tyler Akidau, Slava Chernyak, and Reuven Lax, *[Streaming Systems](https://www.oreilly.com/library/view/streaming-systems/9781491983867/)*
  (O'Reilly Media, 2018), chap. 2, "The What, Where, When, and How of Data
  Processing." Walks through early, on-time, and late results, allowed
  lateness, and the ways successive results of one window can relate to each
  other.

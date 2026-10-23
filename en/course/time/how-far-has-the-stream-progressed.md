# How far has the stream progressed?

> What a watermark tells a processor about event-time progress, and why it is an estimate.

Source: https://stream-processing-systems.github.io/en/course/time/how-far-has-the-stream-progressed/

The map for electric-car drivers groups each charger's readings into
[session windows](https://stream-processing-systems.github.io/en/course/time/sliding-and-session-windows.md) with a ten-minute gap. For
charger `charger-7`, the last reading of the first session came at 09:09 by
event time, so the session ends at 09:19, once ten minutes pass without a
reading. Then the map can stop showing the charger as in use.

But ten minutes of what? The readings travel to the map's processor with
delays, so when its own clock shows 09:19, a reading from 09:15 may still be on
its way. When can the processor decide that event time has passed 09:19?

## Neither the clock nor the latest event

The processor's own clock does not answer this. As we saw with
[event time and processing time](https://stream-processing-systems.github.io/en/course/time/event-time-and-processing-time.md), the gap
between the two changes from record to record. If the feed slows down for a
minute, everything arrives a minute later, and windows closed by the
processor's clock lose their records.

The latest event time seen so far does not answer it either. A reading from
09:21 shows that it is at least 09:21 somewhere, but readings from 09:20 can
still arrive after it. Readings from many chargers share one feed, and they do
not arrive in the order they were taken.

The processor needs a separate signal of progress in event time: a statement
that earlier records are no longer expected.

## A watermark

That signal is called a **watermark**. A watermark of 09:19 says: readings with
event times before 09:19 are no longer expected.[^1] Once the watermark passes
the end of a window, the processor can treat the window as over. Engines differ
on whether a record exactly at the watermark time still counts. Our examples
avoid such records.

Someone has to produce the watermark. Suppose the map knows its feed well:
readings almost never arrive more than two minutes out of order. Then the
processor can keep the watermark two minutes behind the latest event time it
has seen.[^2] Readings from other chargers move it forward too, because the
watermark belongs to the feed, not to one charger.

| Processing time | Reading arrives | Latest event time seen | Watermark | What the processor can do |
| --- | --- | --- | --- | --- |
| 09:09:20 | `charger-7`, 09:09 | 09:09 | 09:07 | Session 1 is open |
| 09:18:30 | `charger-12`, 09:18 | 09:18 | 09:16 | Session 1 is still open: 09:16 is before 09:19 |
| 09:21:10 | `charger-12`, 09:21 | 09:21 | 09:19 | Session 1 `[09:01, 09:19)` is over; the map stops showing `charger-7` as in use |
| 09:24:20 | `charger-7`, 09:24 | 09:24 | 09:22 | Session 2 `[09:24, 09:34)` opens |
| 09:25:00 | `charger-7`, 09:16 | 09:24 | 09:22 | The reading is late: 09:16 is before the watermark |

The reading from 09:16 arrived eight minutes out of order, more than the two
minutes the rule allowed for. The watermark said that earlier readings were no
longer expected, and one came anyway. Records that arrive with event times
before the current watermark are called **late**.[^1]

![The watermark trails the latest event time](diagrams/watermark-lag.svg)

So a watermark is an estimate. If the feed is a file of yesterday's readings
sorted by time, the source knows that nothing earlier will follow, and its
watermark can be exact. A live feed from chargers on mobile connections cannot
know that. Its watermark is a guess based on how the feed usually behaves, and
a reading stuck on a weak connection can prove it wrong.

## How far behind to stay

The two-minute allowance is a choice, and it is the same trade-off as
[holding events](https://stream-processing-systems.github.io/en/course/time/event-time-and-processing-time.md): waiting longer against
being wrong more often. With a ten-minute allowance, the watermark would have
been at 09:14 when the 09:16 reading arrived, so the reading would have come in
time, and session 1 would have merged with session 2 as it should. But the
processor would then need readings eight minutes further ahead in event time
before ending any session. How much longer drivers would see a charger as busy
depends on when such readings arrive.

The difference from holding events is the clock. The hold was measured on the
processor's clock. The watermark is measured in event time, by the readings
themselves. If the map runs yesterday's readings through the processor again, it
may process an hour of readings in a minute. The watermark moves through that
hour as fast as the readings do: windows end when the readings say so, not when
the processor's clock does. To get exactly the same results as the first time,
the records also have to arrive in the same order.

## Several inputs

The map gets readings from two feeds: the city's own chargers come through
feed A, and a partner network's chargers through feed B. Each feed has its own
watermark. Some results use readings from both, such as the number of chargers
in use across the city in each ten-minute window. A window from 09:10 to 09:20
of that count can end only when neither feed can still send a reading from
before 09:20.

So a processor that reads several inputs takes the smallest of their
watermarks as its own.[^3]

| Input | Watermark |
| --- | --- |
| Feed A | 09:23 |
| Feed B | 09:17 |
| The processor | 09:17 |

Feed A has moved past 09:20, but feed B can still send readings from 09:17 to
09:20, and they belong to the window. The slower feed holds back every window
the processor computes, including `charger-7`'s session, even though
`charger-7` reports through feed A.

## An input that falls silent

Late at night, all the partner's chargers stand unused, and feed B sends
nothing. With no readings, its watermark stops moving, and so does the
processor's. Feed A keeps reporting, but no window ends: a charger on feed A
that went quiet an hour ago still shows as in use.

To get unstuck, the processor can mark an input as **idle** after some time
without records, say one minute, and leave it out of the smallest watermark
until it sends something again.[^4] That minute is measured on the processor's
clock, because feed B's event time is exactly what stopped moving.

Marking feed B idle lets the windows end. It does not prove that feed B has
nothing left to send. Its chargers may be unused, or the feed may be down, and
silence looks the same in both cases. If feed B comes back with readings taken
before the processor's watermark, those readings are late.

The watermark gives the processor a moment to act: at 09:19 by event time,
session 1 is over. It does not say what to do around that moment. The map
could show a session's progress before the watermark reaches its end, rather
than keep drivers waiting. And when the late reading from 09:16 arrived, the
session it belonged to was already over. Should the processor still correct it,
and for how long should it keep the state it needs for that?

## What to remember

- A watermark is a signal of progress in event time: records from before it
  are no longer expected. A window can be treated as over once the watermark
  passes its end.
- A watermark that trails the latest event time by an allowance is an estimate.
  A record that arrives behind it is late.
- A larger allowance means fewer late records and later results. The watermark
  moves with the event time of the records, not with the processor's clock.
- A processor with several inputs uses the smallest of their watermarks. An
  idle input can be left out, but its later records may arrive late.

## References

[^1]: [Apache Flink 2.3: Event Time and Watermarks](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/time/#event-time-and-watermarks).
[^2]: [Apache Flink 2.3: Fixed Amount of Lateness](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/event-time/built_in/#fixed-amount-of-lateness).
[^3]: [Apache Flink 2.3: Watermarks in Parallel Streams](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/concepts/time/#watermarks-in-parallel-streams).
[^4]: [Apache Flink 2.3: Dealing With Idle Sources](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/dev/datastream/event-time/generating_watermarks/#dealing-with-idle-sources).

## Further reading

- Tyler Akidau, Slava Chernyak, and Reuven Lax, *[Streaming Systems](https://www.oreilly.com/library/view/streaming-systems/9781491983867/)*
  (O'Reilly Media, 2018), chap. 3, "Watermarks." Explains how sources create
  exact and estimated watermarks, and how watermarks pass through a pipeline of
  several processors.

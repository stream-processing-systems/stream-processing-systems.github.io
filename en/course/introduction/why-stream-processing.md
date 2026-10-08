# Why stream processing?

> When to compute an answer on request, on a schedule, or as each change arrives.

Source: https://stream-processing-systems.github.io/en/course/introduction/why-stream-processing/

Imagine you ordered groceries for delivery. At the store, a picker (the worker
who collects your items) cannot find red apples and proposes green apples
instead.[^1]
The app asks you to accept or decline, and the picker waits for your answer.
You need to see the proposal while the picker is still in the aisle.

The store handles many orders like yours at the same time, and a supervisor
wants an overview of the workload. Both needs depend on the same data: changes
to orders that keep coming in. The question is when to turn those changes into
an answer. There are three common ways to do it.

## Calculate when someone asks

The simplest way is to wait until someone looks. When you open the order page,
the app sends a request. The service reads the order, works out its current
status, and sends back the page. This is **processing on request**: the
calculation runs because someone asked for it.

This works well for checking delivery progress. You look at your order a few
times, reading one order is cheap, and the service does no work while nobody is
looking.

The weakness is that the page shows the order as it was when you opened it. If
the picker proposes a replacement a minute later, you will not see it until you
open the page again. The app could reload every few seconds. That is still
processing on request, and most of those requests would find nothing new.

## Calculate on a schedule

The supervisor needs something different: a list of all active orders. The
store can collect changes and run one calculation every fifteen minutes. Each
run reads everything collected so far, builds the list, and saves it as a
report. This is **batch processing**: a collected set of data is processed
together, in one run.

It suits a report that can wait. One run covers many orders at once, and a
fifteen-minute delay is acceptable for reviewing the store's workload.

The weakness is the gap between runs. If you accept a replacement just after a
run, the report shows your order as waiting for up to fifteen minutes. Running
more often shortens the gap, but each run repeats the work for orders that did
not change, and some gap always remains.

## Process each change as it arrives

A fifteen-minute report is far too slow for the replacement. Reloading every
few seconds would be fast enough, but it means asking about every active order
again and again, while most of them have nothing new to show.

So we turn the approach around. Instead of waiting for a question or a schedule,
the system reacts to each change when it arrives. Each change is recorded as an
**event**: a small record of something that happened, such as "replacement
proposed" or "order packed". When the proposal arrives, the system updates your
order page. When your answer arrives, it updates the picker's screen and the
store's list of orders waiting for a customer.

This is **stream processing**: handling a continuing flow of events as they
arrive and keeping results up to date along the way.

![When each approach calculates the result](diagrams/three-approaches.svg)

The cost is that the system works on every change, even when nobody is looking
at the result. It also needs a way to receive the events and deliver its
updates. None of this requires a special product or a large distributed
system. A small application can read an event, apply one rule, and write the
new result. Teams add specialized tools when there are more
events, more readers of the results, and more ways for things to fail.

## What "real-time" means

Results like these are often called real-time. That does not mean instant. An
event has to be recorded, delivered, processed, and shown, and every step takes
some time. An event can also arrive late, out of order, or not at all. In
practice, real-time means the delay is small enough for a stated purpose. For
the replacement, a few seconds may be fine, while a few minutes are not.

## Which approach fits

Four questions help decide:

1. How quickly does someone need the result?
2. Who needs it, and how often do they look?
3. How often does the data change, and how much work is it to recalculate?
4. What goes wrong if the answer is a few minutes old?

The grocery service answers them differently for each task:

| | Delivery progress | Store overview | Replacement during picking |
| --- | --- | --- | --- |
| How quickly? | When the shopper looks | Every fifteen minutes is enough | Within seconds |
| Who, and how often? | One shopper, a few times | A supervisor, at regular reviews | The shopper, the picker, and store staff, while the order is prepared |
| Changes and cost to recalculate | Few changes; reading one order is cheap | Many orders change; one run covers them all | Changes arrive at unpredictable moments across many orders |
| If a few minutes old? | Nothing; nobody was looking | Little; the report can wait | The picker keeps waiting after you have already answered |
| Fits | Processing on request | Batch processing | Stream processing |

One service can use all three approaches. Stream processing is worth its cost
where a decision depends on changes during ongoing work. Elsewhere, a simpler
approach is enough.

Stream processing reacts to each event, so each event has to say enough. If the
system only receives "order updated", it cannot tell whether to show you a new
proposal or confirm the replacement you accepted. To act on an event, the system
needs to know what happened, to which order, and when.

## What to remember

- A result can be calculated when someone asks, on a schedule over collected
  data, or as each change arrives.
- Stream processing reacts to events as they arrive. It helps when decisions
  depend on changes during ongoing work.
- A real-time result still has a delay, and that delay must be small enough for
  its purpose.
- One service can use different approaches for different tasks.

## References

[^1]: [Uber: Retail Order Fulfillment API Guide](https://developer.uber.com/docs/eats/guides/retail-order-fulfillment).

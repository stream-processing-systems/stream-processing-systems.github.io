# When an event arrives twice or never

> Why a missing acknowledgement makes a sender repeat a record, how a processor recognizes the copy by its event ID, and why removing copies cannot bring back a lost record.

Source: https://stream-processing-systems.github.io/en/course/reliability/when-an-event-arrives-twice-or-never/

At `store-418`, the supervisor's count of packed orders for `[10:00, 10:10)`
[stands at three](https://stream-processing-systems.github.io/en/course/time/when-is-a-window-result-ready.md). Then the packing
record of `ord-1042` arrives again: the connection to the processor dropped,
and the feed sent the record a second time to be safe. The count says four. In
a store, one extra order on the screen is an annoyance. In a service that
charges for every record it counts, the same mistake is a wrong bill.

Consider such a service. A company sells access to an AI assistant and charges
customers for **tokens**, the small pieces of text the model reads and writes.
When a request finishes, the service's gateway, the program that receives
customers' requests, sends a usage record to a usage processor: which account,
how many tokens, and when. The processor adds the tokens to the account's total
for the month. The customer sees that total on a usage page, and at the end of
the month it goes into the bill. On February 2, account `acme` makes three
requests that use 1,000, 400, and 600 tokens, 2,000 in total. How does the
processor count each request once, no more and no less?

## Why a record arrives twice

The gateway and the processor talk over a network. The gateway sends a record,
and the processor replies that it has received it. This reply is called an
**acknowledgement**. Until the acknowledgement arrives, the gateway keeps the
record so that it can send it again.

At 06:00, the gateway sends the record of the second request, `u-102`. The
processor adds 400 tokens and replies, but the reply is lost on the way back.
The gateway cannot tell what happened: either the record never reached the
processor, or it arrived and only the reply was lost. If the gateway gives up,
it may lose 400 tokens of usage. So it sends the record again.

![A lost acknowledgement makes the gateway send the record again](diagrams/lost-acknowledgement.svg)

| Record received | Tokens | Total if the processor adds every record | Total if it recognizes the copy |
| --- | --- | --- | --- |
| `u-101` | 1,000 | 1,000 | 1,000 |
| `u-102` | 400 | 1,400 | 1,400 |
| `u-102` again | 400 | 1,800 | 1,400 |
| `u-103` | 600 | 2,400 | 2,000 |

Sending again keeps usage from being lost. The price is that the processor
sometimes receives one record twice, and it needs a way to tell such a copy
from a new request.

## Telling a copy from a new request

The content of a record cannot do it. `acme` may well make two separate
requests a second apart that each use 400 tokens. Their records would have the
same account, the same token count, and almost the same time. A processor that
treated equal records as copies would drop a real request and undercharge the
customer.

What tells them apart is the identity of the event. Like `event_id` in our
[grocery events](https://stream-processing-systems.github.io/en/course/fundamentals/what-does-an-event-tell-us.md), each usage
record carries a `usage_id` that names one request. The ID belongs to the
request, so the gateway assigns it once, when the request finishes, and every
copy of the record carries the same ID. If the gateway created a new ID for
each send, every copy would look like a new request.

Services that send events to other programs over a network run into the same
problem. Stripe, a payment service, warns that the same event can arrive more
than once and suggests keeping the IDs of events already processed and
skipping any event whose ID is among them.[^1]

The customer's app can also repeat a request. If it gets no answer from the
assistant and sends the request again, the model runs a second time and uses
tokens again. That is a new request with a new `usage_id`, and the customer
pays for it.

## Remembering what was counted

To recognize a copy, the processor has to remember which IDs it has already
counted. For each account, its
[state](https://stream-processing-systems.github.io/en/course/fundamentals/when-one-event-is-not-enough.md) now holds two things:
the total and a list of counted usage IDs, each with its token count. When a
record arrives, the processor checks its ID. A new ID adds its tokens to the
total and joins the list. A known ID changes nothing. Recognizing and skipping copies of a record is
called **deduplication**.

Checking the ID, adding the tokens, and remembering the ID make up one step.
If only part of it happens, the total and the list fall out of step. Remember
`u-102` without adding its 400 tokens, and the copy that follows is skipped, so
the tokens are never counted. Add the tokens without remembering the ID, and
the copy is counted again.

A record with a known ID and a different token count is another matter. The
processor sees the difference because the list keeps each ID's token count.
Such a record cannot be a copy of the same record, and skipping it quietly
would hide an error somewhere before the processor. Our processor sends such records to a
list that staff review.

With deduplication, processing the same record twice has the same effect as
processing it once. An operation with this property is called **idempotent**.
Adding 400 tokens to a total is not idempotent: every repeat changes the total.
"Add the tokens of `u-102` unless `u-102` is already counted" is idempotent:
the second time, it does nothing.

## How long to remember IDs

A busy service handles millions of requests a month, and the list of counted
IDs grows with every one of them. The processor cannot keep them all forever,
so it forgets each ID after a while.

Suppose it keeps each ID for 24 hours after the record arrives. A copy that
comes within 24 hours is recognized. A copy that comes later finds no ID in the
list and is counted again. So the period has to be longer than the longest
possible time between two copies of one record.

Our gateway resends a record every few seconds until it gets an
acknowledgement, so copies of one record usually come seconds apart. They can
be further apart only if the processor received the first copy and then
became unreachable: the gateway keeps resending through the whole outage. A
day of memory covers any outage shorter than a day. For a longer one, the IDs
have to be kept longer too.

That reasoning holds as long as copies come from resending. If someone sends
last week's records once more, for example to recompute the totals after a
bug fix, a one-day memory recognizes none of them, and every total grows again.

## A lost record is a different problem

Deduplication handles extra copies. The opposite failure is a record that never
arrives. Suppose the gateway sends `u-102` once and does not resend it when the
acknowledgement is missing. If the record was lost on the way, the processor
never learns about the request, and the total for `acme` is 1,600.
Deduplication cannot help, because there is no copy to remove. A
[watermark](https://stream-processing-systems.github.io/en/course/time/how-far-has-the-stream-progressed.md) cannot help either:
it estimates how far event time has progressed and knows nothing about records
that were never delivered.

What the sender does after a missing acknowledgement decides which of the two
failures is possible. The resulting promises are called **delivery
guarantees**:

| Guarantee | How it is achieved | Lost records | Records counted twice |
| --- | --- | --- | --- |
| **At-most-once** | The sender sends once and never resends | Possible | No |
| **At-least-once** | The sender keeps the record and resends it until it gets an acknowledgement | No, as long as the receiver is reachable again at some point | Possible |
| **Exactly-once** | At-least-once delivery, and the receiver recognizes copies | No | No |

The name "exactly-once" is easy to misread. Copies still arrive, and the
processor still handles each of them. What happens once is their effect on the
result. Flink defines its exactly-once
guarantee the same way: an event may be processed more than once, but it
affects the state that Flink manages exactly once.[^2]

The right guarantee depends on the result. A live chart of requests per minute
can live with at-most-once, because an occasional missing request barely moves
the line. Usage that ends up on a bill cannot, so our gateway resends, and the
processor deduplicates.

Each guarantee covers one stretch of the path, here between the gateway and
the processor. If the gateway crashes after a request finishes but before it
stores the record, no resending will bring that record back. To catch such
gaps, the service can compare the totals with an independent source, such as
the assistant's own log of the requests it served.

The processor now counts `acme` correctly: 2,000 tokens and three IDs in the
list. Both live in the processor's memory. At 06:05, the processor restarts
after an update, and its memory starts empty. If it gets the total back but not
the list, the next copy of `u-102` looks new. If it gets nothing back, `acme`
starts the month at zero. What does the processor need to keep so that it can
carry on after a restart?

## What to remember

- A sender that gets no acknowledgement cannot tell a lost record from a lost
  reply. Resending prevents loss and produces copies.
- A copy is recognized by the event's ID, which is assigned once per event.
  Records with equal content can still describe different events.
- Deduplication keeps the result and the list of counted IDs in step and makes
  processing a record idempotent. IDs kept for a limited time protect only
  against copies that arrive within that time.
- Removing copies cannot recover a lost record. Delivery guarantees state which
  of the two failures is possible, and each covers one stretch of the path.

## References

[^1]: [Stripe: Handle duplicate events](https://docs.stripe.com/webhooks#handle-duplicate-events).
[^2]: [Apache Flink 2.3: Exactly Once Guarantees](https://nightlies.apache.org/flink/flink-docs-release-2.3/docs/learn-flink/fault_tolerance/#exactly-once-guarantees).

## Further reading

- Josh Fischer and Ning Wang, *[Grokking Streaming Systems](https://www.manning.com/books/grokking-streaming-systems)*
  (Manning, 2022), chap. 5, "Delivery Semantics." Builds at-most-once,
  at-least-once, and exactly-once step by step on one small job, with
  acknowledgements, checkpoints, and idempotent operations.
- Tyler Akidau, Slava Chernyak, and Reuven Lax, *[Streaming Systems](https://www.oreilly.com/library/view/streaming-systems/9781491983867/)*
  (O'Reilly Media, 2018), chap. 5, "Exactly-Once and Side Effects." Shows how
  a processing engine recognizes repeated records by their IDs and how it keeps
  the memory of those IDs from growing without limit.

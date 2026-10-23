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

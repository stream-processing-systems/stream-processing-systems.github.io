# Потоковая обработка

> Курс по потоковой обработке данных.

Статьи нужно читать по порядку: каждая опирается на предыдущие. Каждая ссылка ведёт на текст статьи в Markdown. Курс ещё пишется, новые статьи добавляются в конец.

## Введение

1. [Зачем нужна потоковая обработка?](https://stream-processing-systems.github.io/ru/course/introduction/why-stream-processing.md): Когда считать ответ по запросу, по расписанию или по мере поступления каждого изменения.

## Основы

2. [Что сообщает событие?](https://stream-processing-systems.github.io/ru/course/fundamentals/what-does-an-event-tell-us.md): Что содержит полезная запись о событии и чем событие отличается от команды и текущего состояния.
3. [От событий к результату](https://stream-processing-systems.github.io/ru/course/fundamentals/from-events-to-results.md): Как источник, фильтр, преобразование и приёмник превращают поток разных событий в один результат.
4. [Когда одного события недостаточно](https://stream-processing-systems.github.io/ru/course/fundamentals/when-one-event-is-not-enough.md): Почему некоторые результаты зависят от предыдущих событий и что обработчик хранит между ними.
5. [Группировка событий по ключу](https://stream-processing-systems.github.io/ru/course/fundamentals/grouping-events-by-key.md): Как ключ разделяет память о заказах, когда события многих заказов приходят вперемешку.

## Время и окна

6. [Время события и время обработки](https://stream-processing-systems.github.io/ru/course/time/event-time-and-processing-time.md): Почему у записи два времени — когда событие произошло и когда его обработали — и как выбрать между ними.
7. [Как разложить события по временным окнам](https://stream-processing-systems.github.io/ru/course/time/putting-events-into-time-windows.md): Как обработчик разрезает бесконечный поток на периоды и ведёт отдельный результат для каждого.
8. [Скользящие и сеансовые окна](https://stream-processing-systems.github.io/ru/course/time/sliding-and-session-windows.md): Окна, которые перекрываются, окна, границы которых задают сами данные, и что с каждыми делает поздняя запись.
9. [Насколько продвинулся поток?](https://stream-processing-systems.github.io/ru/course/time/how-far-has-the-stream-progressed.md): Что водяной знак сообщает обработчику о продвижении времени события и почему это оценка.
10. [Когда результат окна готов?](https://stream-processing-systems.github.io/ru/course/time/when-is-a-window-result-ready.md): Когда окно выдаёт результаты, как долго принимает поправки и как получателю читать несколько версий одного результата.

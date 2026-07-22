# msg-preview.js

Легка бібліотека на чистому JavaScript (без залежностей, ~20 КБ) для парсингу та прев'ю файлів Outlook **.msg** прямо в браузері. Файли нікуди не надсилаються — все відбувається локально.

## Можливості

- Парсинг формату OLE Compound File (CFB): FAT, mini-FAT, DIFAT, великі файли
- Тема, відправник (ім'я + SMTP-адреса), дата, транспортні заголовки
- Одержувачі: Кому / Копія / Прихована копія
- Тіло листа: **HTML**, звичайний текст, **стиснений RTF** (декомпресія LZFu)
- Деінкапсуляція HTML із RTF (`\fromhtml1`, MS-OXRTFEX) — коректне прев'ю листів, де HTML збережений лише в RTF
- Юнікод і ANSI-кодування (windows-125x, Shift-JIS, GBK, EUC-KR, KOI8-U тощо), перемикання кодувань за `\fcharset`
- Вкладення зі скачуванням, inline-зображення (`cid:`), вкладені `.msg`-листи (рекурсивно)
- Безпечний рендер HTML: sandbox-iframe без скриптів + додаткове очищення

## Швидкий старт

```html
<script src="msg-preview.js"></script>
<script>
  fileInput.addEventListener('change', async () => {
    const buf = await fileInput.files[0].arrayBuffer();
    MsgPreview.render(buf, document.getElementById('container'));
  });
</script>
```

Або відкрийте **demo.html** — там готова сторінка з drag&drop.

## API

### `MsgPreview.parse(arrayBuffer) -> msg`

Парсить файл і повертає об'єкт:

```js
{
  subject: 'Тема листа',
  senderName: 'Іван Петренко',
  senderEmail: 'ivan@example.com',      // або null
  date: Date,                            // дата отримання/надсилання, або null
  headers: 'Received: ...',              // сирі транспортні заголовки, або null
  recipients: [
    { name: 'Оля', email: 'olia@example.com', type: 'to' } // 'to' | 'cc' | 'bcc'
  ],
  bodyHtml: '<html>…',                   // HTML-тіло, або null
  bodyText: 'текст…',                    // текстове тіло, або null
  bodyRtf: Uint8Array,                   // розпакований RTF, або null
  attachments: [
    {
      name: 'звіт.pdf',
      mime: 'application/pdf',           // або null
      contentId: 'image001@…',           // для inline-зображень, або null
      hidden: false,                     // true для inline-зображень
      data: Uint8Array,                  // вміст, або null
      embedded: {…}                      // вкладений лист (такий самий об'єкт), або null
    }
  ]
}
```

### `MsgPreview.render(bufferOrMsg, containerElement, options?) -> handle`

Малює готове прев'ю (шапка, тіло, вкладення) всередині `containerElement`.
Перший аргумент — `ArrayBuffer` / `Uint8Array`, або вже розібраний об'єкт із `parse()`.

Опції:

| Опція | Тип | Опис |
|---|---|---|
| `locale` | string | Локаль дати, типово `'uk-UA'` |
| `formatDate` | `(Date) => string` | Власне форматування дати |
| `showHiddenAttachments` | boolean | Показувати приховані (inline) вкладення у списку |

Повертає:

```js
{
  element,   // кореневий DOM-елемент прев'ю
  message,   // розібраний об'єкт листа
  destroy()  // прибрати прев'ю і звільнити blob-URL
}
```

### `MsgPreview.decompressRTF(bytes) -> Uint8Array | null`

Окремо доступна декомпресія RTF (LZFu / MELA), якщо потрібен сирий RTF.

## Використання з бандлером / Node

Файл — UMD-модуль:

```js
const MsgPreview = require('./msg-preview.js'); // або import
const msg = MsgPreview.parse(arrayBuffer);      // parse працює і в Node
// render потребує DOM (браузер або jsdom)
```

## Обмеження

- Читання, без редагування чи створення .msg
- Іменовані властивості (custom named properties) не розбираються — для прев'ю вони не потрібні
- RTF-рендер: якщо лист має лише «справжній» RTF (не інкапсульований HTML), показується текстова версія

## Безпека

HTML-тіло рендериться в `<iframe sandbox="allow-same-origin">` — скрипти заборонені; додатково вирізаються `<script>`, обробники `on*=` та `javascript:`-посилання. Зовнішні ресурси в листі (картинки за URL) браузер завантажить, лише якщо лист їх містить; за потреби це можна заблокувати через CSP сторінки.

## Ліцензія

MIT

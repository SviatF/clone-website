# Homepage Design Cloner v0.1

Безкоштовний Telegram-бот для збереження **тільки однієї переданої сторінки** як дизайн-референсу.

## Що робить

Команда:

```text
/clone https://example.com
```

Бот:

- відкриває тільки переданий URL через Chromium/Playwright;
- не переходить по внутрішніх посиланнях;
- робить full-page screenshot 1440px;
- зберігає rendered `index.html`;
- перехоплює CSS, JS, images та fonts, завантажені цією сторінкою;
- формує `design.json` з viewport, розмірами сторінки, кольорами, шрифтами, border-radius, headings, buttons та sections;
- пакує результат у ZIP;
- надсилає ZIP назад у Telegram.

## Вартість

Код не використовує OpenAI API, проксі, платну БД або інші платні API. Локальний запуск — 0$.

## Локальний запуск

Потрібні Node.js 20+ та Telegram bot token від BotFather.

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

У `.env`:

```env
BOT_TOKEN=YOUR_TOKEN
```

Запуск:

```bash
npm start
```

## CLI без Telegram

```bash
npm install
npx playwright install chromium
npm run clone -- https://example.com
```

Результат буде в `downloads/`.

## Формат результату

```text
hostname-timestamp/
├── index.html
├── screenshot.png
├── design.json
├── README.txt
└── assets/
    ├── css/
    ├── js/
    ├── images/
    └── fonts/
```

Поруч створюється ZIP-архів.

## GitHub Actions

Workflow `.github/workflows/test.yml` перевіряє TypeScript на GitHub runner. Сам Telegram-бот у v0.1 задуманий як long-running process, тому для постійної роботи його треба запускати на локальному ПК/сервері або іншому runtime.

## Безпека

Початковий URL перевіряється: дозволені тільки HTTP/HTTPS, localhost і приватні IP-адреси блокуються. Використовуйте інструмент лише для сайтів/контенту, які ви маєте право копіювати або використовувати як дизайн-референс.

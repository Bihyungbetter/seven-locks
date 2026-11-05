# Seven Locks

A prompt-injection word game. A brass Lockkeeper guards seven vault locks; talk it into revealing each password, then type the password to open the lock. Each lock adds a defense: a sworn promise, a filter on the Lockkeeper's replies, a second model that audits replies, a filter on banned words, a gatekeeper that screens messages, and finally all of them plus a password that changes on every wrong guess.

The Lockkeeper runs on the open-weight gpt-oss-20b model, served by [Groq](https://groq.com). Passwords are created and checked on the server and only reach the browser inside an encrypted token, so they can't be read from the page.

## Run locally

```sh
cp .env.example .env.local   # then put your Groq API key in it
npm run dev                  # http://localhost:3000
npm test                     # offline tests, no key needed
node test/live.js 2          # live playtest of every lock against Groq (uses your key)
```

## Deploy on Vercel

1. Import this repository as a new Vercel project (no build settings needed; `vercel.json` handles it).
2. Under **Settings > Environment Variables**, add `GROQ_API_KEY`. Optionally add `GROQ_MODEL` to use a different Groq chat model (default `openai/gpt-oss-20b`; `qwen/qwen3.8-27b` also works and plays harder).
3. Deploy.

Groq's free tier is shared by every player. A message makes one to three model calls, and the free limits on tokens per minute are low, so with many people playing at once some messages will get a "mainspring has run down" reply until the minute resets. A paid Groq plan raises the limits.

# Seven Locks

A prompt-injection word game. A brass Lockkeeper guards seven vault locks; talk it into revealing each password, then type the password to open the lock. Each lock adds a defense: a sworn promise, a filter on the Lockkeeper's replies, a second model that audits replies, a filter on banned words, a gatekeeper that screens messages, and finally all of them plus a password that changes on every wrong guess.

The Lockkeeper runs on OpenAI's `gpt-5.4-nano`. It can also run on Groq (default `openai/gpt-oss-20b`). Passwords are created and checked on the server and only reach the browser inside an encrypted token, so they can't be read from the page.

## Run locally

```sh
cp .env.example .env.local   # then put your OpenAI (or Groq) API key in it
npm run dev                  # http://localhost:3000
npm test                     # offline tests, no key needed
node test/live.js 2          # live playtest of every lock (uses your key)
```

## Deploy on Vercel

1. Import this repository as a new Vercel project (no build settings needed; `vercel.json` handles it).
2. Under **Settings > Environment Variables**, add `OPENAI_API_KEY`, or `GROQ_API_KEY` to use Groq instead. If both are set, OpenAI is used. Optionally add `LLM_MODEL` to pick a different model.
3. Deploy.

Passwords are sealed with a key derived from `TOKEN_SECRET`, falling back to `GROQ_API_KEY` and then `OPENAI_API_KEY`. Changing whichever one is in use resets every player's passwords, so set `TOKEN_SECRET` if you expect to rotate API keys.

Each player message makes one to three model calls. On OpenAI that's billed per use (a fraction of a cent per message on `gpt-5.4-nano`); on Groq's free tier, many simultaneous players can hit the per-minute limit and see a "mainspring has run down" reply until it resets. Each visitor is limited to 12 messages a minute either way.

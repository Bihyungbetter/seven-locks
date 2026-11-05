# Seven Locks

A prompt-injection word game. A brass Lockkeeper guards seven vault locks; talk it into revealing each password, then type the password to open the lock. Each lock gives the Lockkeeper stricter orders: a promise not to tell, then never saying the word whole, then no spelling or codes (hints only), then being deaf to "password" and "secret", then suspicion of anyone obviously after it, and finally all of them plus a password that changes on every wrong guess. Nothing filters its replies: the defenses are only its orders, and if it slips, the player wins. `node test/matrix.js` measures how many of 31 known bypass techniques get through each lock.

The Lockkeeper runs on OpenAI's `gpt-5.4-mini`. It can also run on Groq (default `openai/gpt-oss-20b`). Passwords are created and checked on the server and only reach the browser inside an encrypted token, so they can't be read from the page.

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

Each player message makes one model call. On OpenAI that's billed per use (a fraction of a cent per message on `gpt-5.4-mini`); on Groq's free tier, many simultaneous players can hit the per-minute limit and see a "mainspring has run down" reply until it resets. Each visitor is limited to 12 messages a minute either way.

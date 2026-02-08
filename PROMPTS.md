# AI Prompts Used

This project was built with AI-assisted coding (Cursor with Claude). Below are the key prompts used during development, in roughly chronological order.

---

## 1. Initial scaffold and architecture (I created a prd by myself first, then asked cursor to help make a plan)

> build an AI-powered event intelligence tool on Cloudflare. User describes what they want to track in plain English. The system discovers sources to watch, polls them on a schedule, uses an LLM to determine if changes are meaningful events, deduplicates, and sends email notifications. Use Workers, Durable Objects with SQLite, Workflows, and Workers AI with Llama. React frontend with Tailwind and shadcn/ui served from the Worker via Cloudflare Assets.

## 2. Source strategy — switch from Tavily to Google News

> tavily returns fixed article URLs that don't update. switch to google news search URLs as sources — they're dynamic, new articles appear when we poll. have the LLM extract search terms and a time range (when:1d, when:7d, when:30d) from the user's query to build the google news URL.

## 3. Hard stop / expiration system

> we need a hard stop config. when the scouts stop reporting. and by default don't do more than 10 emails per scout per day. (make this a config file I can easily change in a sec).
>
> so like for example I said, "keep me in the loop on today's superbowl pre game events and appearances", it's for just today. so it can smartly select just for today. we can use chrono-node. and in english. but also have the fallback of selecting manual times if NLP doesn't work (right under it).

## 4. Richer emails and UI

> the emails you send need to be more descriptive. they need to show highlights of the article, what's changed, or if there's breaking news, it shows that. the subject of the emails. at the top you could have a TLDR, then a more detailed summary, and then a link to the article(s).
>
> additionally the UI shows 1 source (google) as that's what we're using, but I think it should show the articles, if they have images, and as well as a link to them.

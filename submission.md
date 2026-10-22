# Step 7 Submission

## 1. GitHub Repository URL (your fork)

https://github.com/LincolnNeilsen/conference-rag

## 2. Live Deployment URL (GitHub Pages)

https://lincolnneilsen.github.io/conference-rag/

## 3. Screenshot of a Working RAG Query + Answer

![RAG query "what is love" with AI answer and sources](Screenshot%20(66).png)

## 4. Custom Feature

I added two panels that compare different ways of searching the same talks.

**Compare Chunking:** One question runs through three chunking strategies side by side: single sentences, sentences with two neighbors on each side (the window), and whole paragraphs. Each column shows its top matches and its own AI answer. I added it to see how chunk size changes what the retriever finds and what the model can answer from. Single sentences are precise but lose context. Paragraphs keep context but match more loosely. The window sits between them.

**Multi-Query Search:** The question is rewritten into three phrasings. Each phrasing is searched against paragraphs, the results are merged with reciprocal rank fusion, and the answer is generated from the merged top paragraphs. I added it because one phrasing can miss talks that use different words for the same idea. Paragraphs that several phrasings find rank higher.

The paragraph chunks came from a second scrape and a new `paragraph_embeddings` table. The multi-query pipeline runs as one server-side Edge Function (`multi-query-search`) so the OpenAI key stays on the server.

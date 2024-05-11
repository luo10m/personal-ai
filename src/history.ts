import { ChatCompletionMessageParam } from "openai/resources";

type ChatEntry = ChatCompletionMessageParam;

export class ChatHistory {
  private static instance: ChatHistory;
  private kv: KVNamespace;
  private cache: Map<string, ChatEntry[]> = new Map();

  private constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  public static getInstance(kv: KVNamespace): ChatHistory {
    if (!ChatHistory.instance) {
      ChatHistory.instance = new ChatHistory(kv);
    }
    return ChatHistory.instance;
  }

  async clear(chat_id: string) {
    await this.kv.delete(chat_id);
    this.cache.delete(chat_id);
  }


  async add(chat_id: string, message: ChatCompletionMessageParam) {
    // Periodically persist cached data to the KV namespace.
    if (!this.cache.has(chat_id)) {
      const chat = await this.kv.get(chat_id);
      this.cache.set(chat_id, chat ? JSON.parse(chat) : []);
    }

    const entries = this.cache.get(chat_id);
    entries.push(message);
    console.log(JSON.stringify(entries, null, 2));

    setInterval(async () => {
      await this.kv.put(chat_id, JSON.stringify(entries));
    }, 5000); // every 5 seconds
  }

  async get(chat_id: string): Promise<ChatEntry[]> {
    // Shoot cache first. If not, get from kv
    if (this.cache.has(chat_id)) {
      return this.cache.get(chat_id);
    }

    const chat = await this.kv.get(chat_id);
    if (!chat) {
      return [];
    }
    const entries = JSON.parse(chat);
    this.cache.set(chat_id, entries);
    console.log(chat);
    return entries;
  }
}

import { ChatCompletionMessageParam } from "openai/resources";

type ChatEntry = ChatCompletionMessageParam;

export class ChatHistory {
  private static instance: ChatHistory;
  private kv: KVNamespace;
  private cache: Map<string, ChatEntry[]> = new Map();
  private persistInterval: NodeJS.Timer;
  private dirtyCache: Set<string> = new Set();

  private constructor(kv: KVNamespace) {
    this.kv = kv;
    this.persistInterval = setInterval(this.persistCache.bind(this), 5000);
  }

  public static getInstance(kv: KVNamespace): ChatHistory {
    if (!ChatHistory.instance) {
      ChatHistory.instance = new ChatHistory(kv);
    }
    return ChatHistory.instance;
  }

  private async persistCache() {
    for (const chatId of Array.from(this.dirtyCache)) {
      const entries = this.cache.get(chatId);
      await this.kv.put(chatId, JSON.stringify(entries));
    }
    this.dirtyCache.clear();
  }

  async clear(chat_id: string) {
    await this.kv.delete(chat_id);
    this.cache.delete(chat_id);
    this.dirtyCache.delete(chat_id);
  }

  async add(chat_id: string, message: ChatCompletionMessageParam) {
    if (!this.cache.has(chat_id)) {
      const chat = await this.kv.get(chat_id);
      this.cache.set(chat_id, chat ? JSON.parse(chat) : []);
    }

    const entries = this.cache.get(chat_id);
    entries.push(message);
    this.dirtyCache.add(chat_id);
  }

  async get(chat_id: string): Promise<ChatEntry[]> {
    if (this.cache.has(chat_id)) {
      return this.cache.get(chat_id);
    }

    const chat = await this.kv.get(chat_id);
    if (!chat) {
      return [];
    }

    const entries = JSON.parse(chat);
    this.cache.set(chat_id, entries);
    return entries;
  }
}

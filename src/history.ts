import { ChatCompletionMessageParam } from "openai/resources";

type ChatEntry = ChatCompletionMessageParam;


export class ChatHistory {
  private static instance: ChatHistory;
  private kv: KVNamespace;

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
  }

  async add(chat_id: string, message: ChatCompletionMessageParam) {
    const chat = await this.kv.get(chat_id);
    if (!chat) {
      await this.kv.put(chat_id, JSON.stringify([message]));
    } else {
      return userId;
    }
  }


  async add(userId: string, date: string, message: ChatCompletionMessageParam) {
    const key = date ? this.getKey(userId, date) : userId;
    const chat = await this.kv.get(key) || '[]';
    const messages: ChatEntry[] = JSON.parse(chat);
    messages.push(message);
    await this.kv.put(key, JSON.stringify(messages));
    console.log("Add()", key, message, JSON.stringify(this.kv.get(key), null, 2));
  }

  async get(userId: string, date?: string, maxMessages?: number): Promise<ChatEntry[]> {
    const key = date ? this.getKey(userId, date) : userId;
    const chat = await this.kv.get(key);
    if (!chat) {
      return [];
    }
    console.log("\nget-chat-history", key, chat, "\n");
    const messages: ChatEntry[] = JSON.parse(chat);
    if (messages.length === 0) {
      return [];
    }
    return this.trimConversation(messages, maxMessages);
  }

  private trimConversation(messages: ChatEntry[], maxMessages: number): ChatEntry[] {
    let conversationCount = 0;
    const trimmedMessages = [];

    for (const message of messages) {
      trimmedMessages.push(message);
      if (message.role !== "tool") {
        conversationCount++;
      }
    }

    const startIndex = Math.max(trimmedMessages.length - maxMessages * 2, 0);
    const results = trimmedMessages.slice(startIndex);
    console.log("Trimmed messages", results);
    return results;
  }


}

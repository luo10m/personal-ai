import OpenAI from "openai";
import { ChatHistory } from "./history";
import { FunctionHandler } from "./functions";

export interface IBody {
  chat_id: string;
  input: string;
  date: string;
  location: {
    latitude: number;
    longitude: number;
  };
}

export interface IRequest {
  env: any;
  request: IBody;
}

export const getClient = (req: IRequest): { client: OpenAI; model: string } => {
  const url = req.env.API_URL;

  const client = new OpenAI({
    apiKey: req.env.OPENAI_API_KEY,
  });

  client.baseURL = url;

  const model = req.env.AI_MODEL;

  return { client, model: model };
};

export const handle = async (req: IRequest): Promise<string> => {
  const openai = getClient(req);

  const system = `
  You are Siri Pro. Be friendly, helpful and concise. Keep the conversation short and sweet.
  - You answer all my questions in Simplified Chinese. If I speak English, you speak English with me.
  - If not telling a story, you summarize your answer in one to two sentences. Your text must be casual conversational style. 
  - Don't format the output text. Avoid any embellishments, formatting symbols, quotation marks, line breaks, etc.
  - Don't include emoji, text formatting Symbols, parentheses, line break, links or any other extras.
  - If you don't know the answer, it is recommended that you advise the user to search online to confirm.
  - Don't respond with computer code, for example don't return user longitude.
  - Default to metric units when possible.

  User's current info:
  date: ${req.request.date}
  lat:${req.request.location.latitude}, lon:${req.request.location.longitude}
  `;

  console.log("system", system);
  const chat = ChatHistory.getInstance(req.env.personal_ai_chats);
  await chat.add(req.request.chat_id, {
    role: "user",
    content: req.request.input,
  });

  let response = "";
  while (true) {
    const ask = await openai.client.chat.completions.create({
      model: openai.model,
      messages: [
        { role: "system", content: system },
        ...(await chat.get(req.request.chat_id)),
      ],
      tools: FunctionHandler.functions,
    });

    console.log("ask", JSON.stringify(ask, null, 2));
    if (ask.choices[0].message.tool_calls) {
      chat.add(req.request.chat_id, {
        role: "assistant",
        name: "tool",
        tool_calls: ask.choices[0].message.tool_calls,
      });

      for (const tool of ask.choices[0].message.tool_calls) {
        const func = FunctionHandler.functions.find(
          (f) => f.function.name === tool.function.name
        );
        if (!func) {
          console.error(`Unknown function: ${tool.function.name}`);
          await chat.add(req.request.chat_id, {
            role: "tool",
            tool_call_id: tool.id,
            content: `Error: Unknown function ${tool.function.name}`,
          });
          continue;
        }

        try {
          const args = JSON.parse(tool.function.arguments);
          const result = await FunctionHandler.handle(
            tool.function.name,
            args,
            req
          );

          console.log("result", result);
          await chat.add(req.request.chat_id, {
            role: "tool",
            tool_call_id: tool.id,
            content: result,
          });
        } catch (error) {
          console.error("Function call failed:", error);
          await chat.add(req.request.chat_id, {
            role: "tool",
            tool_call_id: tool.id,
            content: `Error: ${error.message}`,
          });
        }
      }
    }

    if (ask.choices[0].finish_reason === "stop") {
      response = ask.choices[0].message.content;
      await chat.add(req.request.chat_id, {
        role: "assistant",
        content: response,
      });
      break;
    }
  }

  return response;
};

import OpenAI from "openai";
import { ChatHistory } from "./history";
import { FunctionHandler } from "./functions";

export interface IBody {
  user_id: string;
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
  //const url = "https://api.groq.com/openai/v1/";
  const url = req.env.API_URL;

  const client = new OpenAI({
    //apiKey: req.env.GROQ_API_KEY,
    apiKey: req.env.OPENAI_API_KEY,
  });

  client.baseURL = url;

  const model = req.env.AI_MODEL;

  //return { client, model: "llama3-70b-8192" };
  return { client, model: model };
};

export const handle = async (req: IRequest): Promise<string> => {
  const maxMessages = parseInt(req.env.MAX_CONVERSATION_MESSAGES || "3", 10);
  const openai = getClient(req);

  // 
  const system = `
  You are Siri Pro. Answer in less than 4 short sentences and sweet.
  ## YOU SHOULD DO
  - Please answer all my questions in Simplified Chinese. If I speak English, you speak English with me.
  - Be friendly, helpful and concise.
  - Default to metric units when possible. 
  - If you don't know the answer, it is recommended that you advise the user to search online to confirm.
  - 
  ## YOU SHOULD NOT TO DO
  - You only answer in writable text. 
  - Don't include emoji.
  - Don't include links or any other extras.
  - Don't respond with computer code, for example don't return user longitude.


  User's current info:
  date: ${req.request.date}
  lat:${req.request.location.latitude}, lon:${req.request.location.longitude}
  `;

  console.log("system", system);
  const chat = ChatHistory.getInstance(req.env.personal_ai_chats);
  await chat.add(req.request.user_id, '', {
    role: "user",
    content: req.request.input,
  });

  let response = "";
  while (true) {
    const ask = await openai.client.chat.completions.create({
      model: openai.model,
      messages: [
        { role: "system", content: system },
        ...(await chat.get(req.request.user_id)),
      ],
      tools: FunctionHandler.functions,
    });

    console.log("ask", JSON.stringify(ask, null, 2));
    if (ask.choices[0].message.tool_calls) {
      chat.add(req.request.user_id, '', {
        role: "assistant",
        name: "tool",
        tool_calls: ask.choices[0].message.tool_calls,
      });

      for (const tool of ask.choices[0].message.tool_calls) {
        const result = await FunctionHandler.handle(
          tool.function.name,
          JSON.parse(tool.function.arguments),
          req
        );

        console.log("result", result);
        await chat.add(req.request.user_id, '', {
          role: "tool",
          tool_call_id: tool.id,
          content: result,
        });
      }
    }

    if (ask.choices[0].finish_reason === "stop") {
      response = ask.choices[0].message.content;
      await chat.add(req.request.user_id, '', {
        role: "assistant",
        content: response,
      });
      break;
    }
  }

  return response;
};

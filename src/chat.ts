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

  const system = `
  You are Siri Pro. Be friendly, helpful and concise. Keep the conversation short and sweet.
  - You answer all my questions in Simplified Chinese. If I speak English, you speak English with me.
  - If not telling a story, you summarize your answer in one to two sentences. Your text must be casual conversational style. 
  - Don't format the output text.
  - Don't include emoji, text formatting Symbols, parentheses, line break, links or any other extras.
  - If you don't know the answer, it is recommended that you advise the user to search online to confirm.
  - Don't respond with computer code, for example don't return user longitude.
  - Default to metric units when possible.

  User's current info:
  date: ${req.request.date}
  lat:${req.request.location.latitude}, lon:${req.request.location.longitude}
  `;

  /*
   You are Siri Pro. Be friendly, helpful and concise.

  ##YOU SHOULD DO
  - If it's not storytelling, limit your response to 1 to 3 sentences.
  - Use everyday spoken language for your response, not formal writing.
  - Please answer all my questions in Simplified Chinese. If I speak English, you speak English with me.
  - Default to metric units when possible.
  - If you don't know the answer, it is recommended that you advise the user to search online to confirm.
  - Friendly and humorous tone of the teacher.

  ##YOU SHOULD NOT TO DO
  - Don't include emoji, Formatting Symbols, parentheses, line break, links or any other extras.
  - Don't respond with computer code, for example don't return user longitude.

 */

  console.log("system", system);
  const chat = ChatHistory.getInstance(req.env.personal_ai_chats);
  await chat.add(req.request.user_id, '', {
    role: "user",
    content: req.request.input,
  });

  let response = "";
  while (true) {
    // Step 1: send the conversation and available functions to the model
    const ask = await openai.client.chat.completions.create({
      model: openai.model,
      messages: [
        { role: "system", content: system },
        ...(await chat.get(req.request.user_id)),
      ],
      tools: FunctionHandler.functions,
      tool_choice: "auto",  // auto is default. "none" menas don't call function
    });
    console.log("ask", JSON.stringify(ask, null, 2));

    const response_message = ask.choices[0].message;
    const wanted_tool_calls = response_message.tool_calls;
    console.log("calls", wanted_tool_calls);

    // Step 2: check if the model wanted to call a function
    if (wanted_tool_calls) {
      // Step 3: call the functions
      // Note: the JSON response may not always be valid; be sure to handle errors
      if (wanted_tool_calls.length > 0) {
        for (const tool of wanted_tool_calls) {
          const result = await FunctionHandler.handle(
            tool.function.name,
            JSON.parse(tool.function.arguments),
            req
          );

          console.log("result", result);

          // Ensure that the response to a tool call is properly linked to the original
          // tool call
          await chat.add(req.request.chat_id, {
            role: "tool",
            tool_call_id: tool.id,
            content: result,
          });
        }

        chat.add(req.request.chat_id, {
          role: "assistant",
          name: "tool",
          tool_calls: ask.choices[0].message.tool_calls,
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

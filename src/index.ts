import { Hono } from "hono";
import { handle, IBody } from "./chat";
import { ChatHistory } from "./history";

const app = new Hono();

app.post("/", async (c) => {
  const body = (await c.req.json()) as IBody;
  try {
    console.log(JSON.stringify(body, null, 2));
    const response = await handle({
      env: c.env,
      request: body,
    });

    return c.json({
      response,
    });
  } catch (error) {
    console.log(error);

    // Clear chat history if met error
    const chat = ChatHistory.getInstance(c.env.personal_ai_chats as KVNamespace<string>);
    await chat.clear(body.chat_id);

    return c.json({
      //response: `Something went wrong, we are working on it. Error: ${error.message}`,
      response: "抱歉出错了。请试试别的",
    });
  }
});

export default app;

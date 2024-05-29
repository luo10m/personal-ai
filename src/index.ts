import { Hono } from "hono";
import { handleTextRequest, IBody } from "./chat";
import { ChatHistory } from "./history";
import { handleAudioRequest } from "./asr";

const app = new Hono();

app.post("/", async (c) => {
  const body = (await c.req.json()) as IBody;
  switch (body.type) {
    case "text":
      try {
        console.log(JSON.stringify(body, null, 2));
        const response = await handleTextRequest({
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
  }
});


app.post("/audio", async (c) => {
  // 解析 multipart/form-data 请求
  const formData = await c.req.parseBody();
  // console.log("formData: ", formData);

  // 从 fields 中获取 data 字段并解析为 JSON 对象
  const body = JSON.parse(formData.data);
  // console.log("body:", body);

  // 从 files 中获取上传的音频文件
  const audioFile = formData.stream;
  // console.log("stream: ", audioFile);

  // 调用 handleAudioRequest 处理请求
  const response = await handleAudioRequest({
    env: c.env,
    request: body,
    audioFile: audioFile
  });

  return c.json({ response });

  // return c.json({ content: "I am okay" });
});


export default app;

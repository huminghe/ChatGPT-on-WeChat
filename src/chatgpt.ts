import { Config } from "./config.js";
import { Message } from "wechaty";
import { ContactInterface, RoomInterface } from "wechaty/impls";
import { Configuration, OpenAIApi } from "openai";

// ChatGPT error response configuration
const chatgptErrorMessage = "🤖️：AI机器人摆烂了，请稍后再试～";

// ChatGPT model configuration
// please refer to the OpenAI API doc: https://beta.openai.com/docs/api-reference/introduction
const ChatGPTModelConfig = {
  // this model field is required
  model: "text-davinci-003",
  // add your ChatGPT model parameters below
  temperature: 1.0,
  max_tokens: 1000,
};

// message size for a single reply by the bot
const SINGLE_MESSAGE_MAX_SIZE = 500;

enum MessageType {
  Unknown = 0,
  Attachment = 1, // Attach(6),
  Audio = 2, // Audio(1), Voice(34)
  Contact = 3, // ShareCard(42)
  ChatHistory = 4, // ChatHistory(19)
  Emoticon = 5, // Sticker: Emoticon(15), Emoticon(47)
  Image = 6, // Img(2), Image(3)
  Text = 7, // Text(1)
  Location = 8, // Location(48)
  MiniProgram = 9, // MiniProgram(33)
  GroupNote = 10, // GroupNote(53)
  Transfer = 11, // Transfers(2000)
  RedEnvelope = 12, // RedEnvelopes(2001)
  Recalled = 13, // Recalled(10002)
  Url = 14, // Url(5)
  Video = 15, // Video(4), Video(43)
  Post = 16, // Moment, Channel, Tweet, etc
}

export class ChatGPTBot {
  botName: string = "";
  chatgptTriggerKeyword = Config.chatgptTriggerKeyword;
  OpenAIConfig: any; // OpenAI API key
  OpenAI: any; // OpenAI API instance
  contextMap: Map<string, string> = new Map();

  // Chatgpt fine-tune for being a chatbot (guided by OpenAI official document)
  applyContext(text: string, id: string, prefix: string): string {
    let context = this.contextMap.get(id);
    if (context === undefined) {
      context = "";
    }
    const introduction = "The following is a conversation of a boy with his girlfriend. You are a helpful, creative, clever, sweet, sexy, and very friendly girl.\n";
    context = context + prefix + text;
    this.contextMap.set(id, context);
    if (context.length > 1000) {
      context = "..." + context.substring(context.length - 1000, context.length);
    }
    return introduction + context + "\nGirl:";
  }

  setBotName(botName: string) {
    this.botName = botName;
  }

  // get trigger keyword in group chat: (@Name <keyword>)
  // in group chat, replace the special character after "@username" to space
  // to prevent cross-platfrom mention issue
  get chatGroupTriggerKeyword(): string {
    return `@${this.botName} ${this.chatgptTriggerKeyword || ""}`;
  }

  // configure API with model API keys and run an initial test
  async startGPTBot() {
    try {
      // OpenAI Account configuration
      this.OpenAIConfig = new Configuration({
        organization: Config.openaiOrganizationID,
        apiKey: Config.openaiApiKey,
      });
      // OpenAI API instance
      this.OpenAI = new OpenAIApi(this.OpenAIConfig);
      // Hint user the trigger keyword in private chat and group chat
      console.log(`🤖️ Chatbot name is: ${this.botName}`);
      console.log(`🎯 Trigger keyword in private chat is: ${this.chatgptTriggerKeyword}`);
      console.log(`🎯 Trigger keyword in group chat is: ${this.chatGroupTriggerKeyword}`);
      // Run an initial test to confirm API works fine
      await this.onChatGPT("Say Hello World", "test");
      console.log(`✅ Chatbot starts success, ready to handle message!`);
    } catch (e) {
      console.error(`❌ ${e}`);
    }
  }

  // get clean message by removing reply separater and group mention characters
  cleanMessage(rawText: string, isPrivateChat: boolean = false): string {
    let text = rawText;
    const item = rawText.split("- - - - - - - - - - - - - - -");
    if (item.length > 1) {
      text = item[item.length - 1];
    }
    return text.slice(
      isPrivateChat
        ? this.chatgptTriggerKeyword.length
        : this.chatGroupTriggerKeyword.length
    );
  }

  // check whether ChatGPT bot can be triggered
  triggerGPTMessage(text: string, isPrivateChat: boolean = false): boolean {
    const chatgptTriggerKeyword = this.chatgptTriggerKeyword;
    let triggered = false;
    console.log(`if private chat: ${isPrivateChat}`);
    console.log(`text: ${text}`);
    if (isPrivateChat) {
      triggered = chatgptTriggerKeyword
        ? text.startsWith(chatgptTriggerKeyword)
        : true;
    } else {
      // due to un-unified @ lagging character, ignore it and just match:
      //    1. the "@username" (mention)
      //    2. trigger keyword
      // start with @username
      const textMention = `@${this.botName}`;
      const startsWithMention = text.startsWith(textMention);
      const textWithoutMention = text.slice(textMention.length + 1);
      const followByTriggerKeyword = textWithoutMention.startsWith(
        this.chatgptTriggerKeyword
      );
      triggered = startsWithMention && followByTriggerKeyword;
    }
    if (triggered) {
      console.log(`🎯 Chatbot triggered: ${text}`);
    }
    return triggered;
  }

  // filter out the message that does not need to be processed
  isNonsense(
    talker: ContactInterface,
    messageType: MessageType,
    text: string
  ): boolean {
    return (
      // self-chatting can be used for testing
      talker.self() ||
      messageType != MessageType.Text ||
      talker.name() == "微信团队" ||
      // video or voice reminder
      text.includes("收到一条视频/语音聊天消息，请在手机上查看") ||
      // red pocket reminder
      text.includes("收到红包，请在手机上查看") ||
      // location information
      text.includes("/cgi-bin/mmwebwx-bin/webwxgetpubliclinkimg")
    );
  }

  // send question to ChatGPT with OpenAI API and get answer
  async onChatGPT(text: string, id: string): Promise<string> {
    console.log("text user id: ", id);
    const inputMessage = this.applyContext(text, id, "\nBoy:");
    try {
      // config OpenAI API request body
      const response = await this.OpenAI.createCompletion({
        ...ChatGPTModelConfig,
        prompt: inputMessage,
        stop: [" Boy:", " Girl:"]
      });
      // use OpenAI API to get ChatGPT reply message
      const chatgptReplyMessage = response?.data?.choices[0]?.text?.trim();
      let replyMessage = chatgptReplyMessage;
      if (replyMessage.length > 150) {
        replyMessage = replyMessage.substring(0, 150) + "...";
      }
      this.applyContext(replyMessage, id, "\nGirl:");
      console.log("🤖️ Chatbot says: ", chatgptReplyMessage);
      return chatgptReplyMessage;
    } catch (e: any) {
      const errorResponse = e?.response;
      const errorCode = errorResponse?.status;
      const errorStatus = errorResponse?.statusText;
      const errorMessage = errorResponse?.data?.error?.message;
      console.error(`❌ Code ${errorCode}: ${errorStatus}`);
      console.error(`❌ ${errorMessage}`);
      return chatgptErrorMessage;
    }
  }

  // reply with the segmented messages from a single-long message
  async reply(
    talker: RoomInterface | ContactInterface,
    mesasge: string
  ): Promise<void> {
    const messages: Array<string> = [];
    let message = mesasge;
    while (message.length > SINGLE_MESSAGE_MAX_SIZE) {
      messages.push(message.slice(0, SINGLE_MESSAGE_MAX_SIZE));
      message = message.slice(SINGLE_MESSAGE_MAX_SIZE);
    }
    messages.push(message);
    for (const msg of messages) {
      await talker.say(msg);
    }
  }

  // reply to private message
  async onPrivateMessage(talker: ContactInterface, text: string) {
    // get reply from ChatGPT
    const id = talker.id;
    const chatgptReplyMessage = await this.onChatGPT(text, id);
    // send the ChatGPT reply to chat
    await this.reply(talker, chatgptReplyMessage);
  }

  // reply to group message
  async onGroupMessage(room: RoomInterface, text: string) {
    // get reply from ChatGPT
    const id = room.id;
    const chatgptReplyMessage = await this.onChatGPT(text, id);
    // the reply consist of: original text and bot reply
    const wholeReplyMessage = `${text}\n----------\n${chatgptReplyMessage}`;
    await this.reply(room, wholeReplyMessage);
  }

  // receive a message (main entry)
  async onMessage(message: Message) {
    const talker = message.talker();
    const rawText = message.text();
    const room = message.room();
    const messageType = message.type();
    const isPrivateChat = !room;
    // do nothing if the message:
    //    1. is irrelevant (e.g. voice, video, location...), or
    //    2. doesn't trigger bot (e.g. wrong trigger-word)
    if (
      this.isNonsense(talker, messageType, rawText) ||
      !this.triggerGPTMessage(rawText, isPrivateChat)
    ) {
      return;
    }
    // clean the message for ChatGPT input
    const text = this.cleanMessage(rawText, isPrivateChat);
    // reply to private or group chat
    if (isPrivateChat) {
      return await this.onPrivateMessage(talker, text);
    } else {
      return await this.onGroupMessage(room, text);
    }
  }
}

export class TelegramClient {
  private readonly token: string | undefined;
  private readonly chatId: string | undefined;

  constructor(token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID) {
    this.token = token;
    this.chatId = chatId;
  }

  async send(message: string): Promise<void> {
    if (!this.token || !this.chatId) {
      console.warn('Skipping telegram send because TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.');
      return;
    }
    const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(`Telegram send failed with status ${response.status}`);
    }
    if (!payload?.ok) {
      const description = typeof payload?.description === 'string' ? payload.description : 'unknown error';
      throw new Error(`Telegram send failed: ${description}`);
    }
  }
}

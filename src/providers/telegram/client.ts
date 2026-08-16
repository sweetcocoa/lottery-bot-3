type FetchImplementation = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

const MAX_SEND_ATTEMPTS = 3;

class TelegramSendError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export class TelegramClient {
  private readonly token: string | undefined;
  private readonly chatId: string | undefined;
  private readonly fetchImplementation: FetchImplementation;
  private readonly sleep: Sleep;

  constructor(
    token = process.env.TELEGRAM_BOT_TOKEN,
    chatId = process.env.TELEGRAM_CHAT_ID,
    fetchImplementation: FetchImplementation = fetch,
    sleep: Sleep = delay,
  ) {
    this.token = token;
    this.chatId = chatId;
    this.fetchImplementation = fetchImplementation;
    this.sleep = sleep;
  }

  async send(message: string): Promise<void> {
    if (!this.token || !this.chatId) {
      console.warn('Skipping telegram send because TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.');
      return;
    }

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.fetchImplementation(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text: message,
            disable_web_page_preview: true,
          }),
        });
        const payload = await parsePayload(response);
        if (response.ok && payload?.ok) {
          return;
        }

        throw new TelegramSendError(
          response.ok
            ? `Telegram send failed: ${telegramErrorDescription(payload)}`
            : `Telegram send failed with status ${response.status}`,
          isRetryableTelegramStatus(response.status),
        );
      } catch (error) {
        if (error instanceof TelegramSendError && !error.retryable) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < MAX_SEND_ATTEMPTS) {
        await this.sleep(1000 * 2 ** (attempt - 1));
      }
    }

    throw new Error(`Telegram send failed after ${MAX_SEND_ATTEMPTS} attempts: ${lastError?.message ?? 'unknown error'}`);
  }
}

export function isRetryableTelegramStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function parsePayload(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function telegramErrorDescription(payload: any): string {
  return typeof payload?.description === 'string' ? payload.description : 'unknown error';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

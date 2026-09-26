import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

interface SmsDeliveryResult {
  provider: 'africastalking' | 'dummy';
  messageId?: string;
}

@Injectable()
export class SmsGatewayService {
  private readonly logger = new Logger(SmsGatewayService.name);

  async sendVerificationCode(destination: string, code: string): Promise<SmsDeliveryResult> {
    const provider = (process.env.SMS_PROVIDER || 'africastalking').toLowerCase();
    if (provider === 'dummy') {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException('SMS delivery is not configured');
      }
      this.logger.warn("OTP delivery simulated; configure Africa's Talking for actual delivery");
      return { provider: 'dummy' };
    }

    if (provider !== 'africastalking') {
      throw new ServiceUnavailableException('Configured SMS provider is not supported');
    }

    const username = process.env.AFRICASTALKING_USERNAME;
    const apiKey = process.env.AFRICASTALKING_API_KEY;
    if (!username || !apiKey) {
      throw new ServiceUnavailableException('Africa\'s Talking SMS credentials are not configured');
    }

    const body = new URLSearchParams({
      username,
      to: destination,
      message: `Your Milkos verification code is ${code}. It expires in 10 minutes.`,
    });
    if (process.env.AFRICASTALKING_SENDER_ID) {
      body.set('from', process.env.AFRICASTALKING_SENDER_ID);
    }

    let response: Response;
    try {
      response = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException('SMS provider could not be reached');
    }

    if (!response.ok) {
      this.logger.error(`Africa's Talking rejected SMS delivery with HTTP ${response.status}`);
      throw new ServiceUnavailableException('SMS delivery failed');
    }

    const result = await response.json().catch(() => null) as {
      SMSMessageData?: { Recipients?: Array<{ statusCode?: number; messageId?: string }> };
    } | null;
    const recipient = result?.SMSMessageData?.Recipients?.[0];
    if (recipient?.statusCode !== 101) {
      this.logger.error(`Africa's Talking returned an unsuccessful delivery status: ${recipient?.statusCode ?? 'unknown'}`);
      throw new ServiceUnavailableException('SMS delivery failed');
    }

    return { provider: 'africastalking', messageId: recipient.messageId };
  }
}
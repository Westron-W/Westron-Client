import nodemailer from 'nodemailer';

const RETRYABLE_CODES = new Set([
  'ECONNECTION',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
]);

function isRetryable(error) {
  return RETRYABLE_CODES.has(error.code)
    || Number.isInteger(error.responseCode) && error.responseCode >= 400 && error.responseCode < 500;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createMailer(env = process.env) {
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing SMTP environment settings: ${missing.join(', ')}`);
  const tokenTtlMinutes = Number(env.ONE_TIME_TOKEN_TTL_MINUTES || 30);
  if (!Number.isSafeInteger(tokenTtlMinutes) || tokenTtlMinutes < 1) {
    throw new Error('ONE_TIME_TOKEN_TTL_MINUTES must be a positive integer');
  }

  const port = Number(env.SMTP_PORT || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be between 1 and 65535');
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE === 'true' || port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    logger: false,
    debug: false,
    tls: { rejectUnauthorized: true },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  async function sendMail({ to, subject, text }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await transporter.sendMail({
          from: env.SMTP_FROM,
          to,
          subject,
          text,
        });
        return;
      } catch (error) {
        if (!isRetryable(error) || attempt === 2) {
          const deliveryError = new Error('Email delivery failed');
          deliveryError.code = error.code || 'SMTP_DELIVERY_FAILED';
          throw deliveryError;
        }
        await delay(250 * (2 ** attempt));
      }
    }
  }

  return {
    sendVerification: (email, username, token) => sendMail({
      to: email,
      subject: 'Westron hesabı e-posta doğrulaması',
      text: `Merhaba ${username},\n\nWestron hesabınızı doğrulamak için bu kodu launcher'a girin:\n\n${token}\n\nKod ${tokenTtlMinutes} dakika içinde sona erer. Bu isteği siz başlatmadıysanız bu e-postayı yok sayın.`,
    }),
    sendPasswordReset: (email, username, token) => sendMail({
      to: email,
      subject: 'Westron hesabı parola sıfırlama',
      text: `Merhaba ${username},\n\nParolanızı yenilemek için bu kodu launcher'a girin:\n\n${token}\n\nKod ${tokenTtlMinutes} dakika içinde sona erer. Bu isteği siz başlatmadıysanız bu e-postayı yok sayın.`,
    }),
  };
}

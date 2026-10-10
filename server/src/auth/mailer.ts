import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { Config } from '../config';
import { log } from '../log';
import { CODE_TTL_MS } from './codes';

export interface Mailer {
  sendCode(email: string, code: string): Promise<void>;
}

export interface CodeEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function codeEmail(email: string, code: string, appUrl: URL): CodeEmail {
  const minutes = Math.round(CODE_TTL_MS / 60_000);
  const text = [
    `Your DevsBooth sign-in code is ${code}.`,
    '',
    `It expires in ${minutes} minutes. If you did not ask for it, you can ignore this email.`,
    '',
    appUrl.origin,
  ].join('\n');
  const html = `<p>Your DevsBooth sign-in code is</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">${code}</p>
<p>It expires in ${minutes} minutes. If you did not ask for it, you can ignore this email.</p>
<p><a href="${appUrl.origin}">${appUrl.host}</a></p>`;
  return { to: email, subject: `${code} is your DevsBooth code`, text, html };
}

/** Prints codes to the server log. The default, so a fresh install works with no mail setup. */
function logMailer(): Mailer {
  return {
    async sendCode(email, code) {
      log.info(`Sign-in code for ${email}: ${code}`);
    },
  };
}

/** Writes each email as JSON into a directory. Used by the end-to-end tests. */
function fileMailer(outboxDir: string, appUrl: URL): Mailer {
  return {
    async sendCode(email, code) {
      await mkdir(outboxDir, { recursive: true });
      const message = { ...codeEmail(email, code, appUrl), sentAt: new Date().toISOString() };
      const name = `${Date.now()}-${email.replace(/[^a-z0-9]+/gi, '_')}.json`;
      await writeFile(path.join(outboxDir, name), JSON.stringify(message, null, 2));
    },
  };
}

function smtpMailer(smtpUrl: string, from: string, appUrl: URL): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async sendCode(email, code) {
      await transport.sendMail({ from, ...codeEmail(email, code, appUrl) });
    },
  };
}

export function createMailer(config: Config): Mailer {
  const { transport, smtpUrl, from, outboxDir } = config.mail;
  switch (transport) {
    case 'smtp':
      return smtpMailer(smtpUrl!, from, config.appUrl);
    case 'file':
      return fileMailer(outboxDir, config.appUrl);
    case 'log':
      return logMailer();
  }
}

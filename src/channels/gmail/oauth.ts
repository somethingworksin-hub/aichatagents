import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { config } from "../../config";

const TOKEN_PATH = path.join(process.cwd(), "gmail-token.json");

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

export function createOAuthClient() {
  return new google.auth.OAuth2(config.gmail.clientId, config.gmail.clientSecret, config.gmail.redirectUri);
}

export function getAuthUrl(): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
  });
}

export async function exchangeCodeForToken(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  return tokens;
}

export function hasStoredToken(): boolean {
  return fs.existsSync(TOKEN_PATH);
}

export async function getAuthorizedClient() {
  if (!hasStoredToken()) {
    throw new Error(
      `No Gmail token found. Visit /gmail/auth on your running server (or run the OAuth flow) to authorize access first.`
    );
  }
  const client = createOAuthClient();
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  client.setCredentials(tokens);

  client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });

  return client;
}

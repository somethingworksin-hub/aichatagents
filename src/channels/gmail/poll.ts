import { config } from "../../config";
import { hasStoredToken } from "./oauth";
import { processUnreadMessages } from "./service";

/**
 * Standalone poller: `npm run gmail:poll`
 * Runs alongside (or instead of) the main server, checking for new unread
 * mail on an interval and auto-replying via the shared Claude engine.
 *
 * For production, prefer Gmail push notifications (Cloud Pub/Sub) over
 * polling — see README for the swap-in approach.
 */
async function main() {
  if (!hasStoredToken()) {
    console.error(
      "[gmail] No stored token found. Start the server and visit /gmail/auth to authorize this app first."
    );
    process.exit(1);
  }

  console.log(`[gmail] polling every ${config.gmail.pollIntervalMs}ms`);

  const tick = async () => {
    try {
      await processUnreadMessages();
    } catch (err) {
      console.error("[gmail] poll tick failed", err);
    }
  };

  await tick();
  setInterval(tick, config.gmail.pollIntervalMs);
}

main();

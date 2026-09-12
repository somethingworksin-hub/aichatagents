import { processUnreadMessagesForAllTenants } from "./service";

/**
 * Standalone poller: `npm run gmail:poll`
 * Runs alongside (or instead of) the main server, checking every tenant
 * that has connected Gmail for new unread mail on an interval and
 * auto-replying via each tenant's configured AI provider/persona.
 *
 * On Cloud Run (which scales to zero when idle), prefer POST /gmail/poll
 * triggered by Cloud Scheduler instead — see the README. This long-running
 * process is meant for hosts that keep a background worker alive (Render
 * background workers, a VPS, etc.).
 */
const POLL_INTERVAL_MS = Number(process.env.GMAIL_POLL_INTERVAL_MS || 60000);

async function main() {
  console.log(`[gmail] polling all tenants every ${POLL_INTERVAL_MS}ms`);

  const tick = async () => {
    try {
      await processUnreadMessagesForAllTenants();
    } catch (err) {
      console.error("[gmail] poll tick failed", err);
    }
  };

  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

main();

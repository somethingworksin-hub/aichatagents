/**
 * Embeddable chat widget.
 *
 * Usage: add this to any page on your site:
 *   <script src="https://your-server.example.com/widget.js" data-api-base="https://your-server.example.com"></script>
 */
(function () {
  var scriptTag = document.currentScript;
  var apiBase = (scriptTag && scriptTag.getAttribute("data-api-base")) || "";
  var botName = (scriptTag && scriptTag.getAttribute("data-bot-name")) || "Chat with us";
  var storageKey = "aichat_session_id";

  function getSessionId() {
    try {
      return localStorage.getItem(storageKey) || "";
    } catch (e) {
      return "";
    }
  }

  function setSessionId(id) {
    try {
      localStorage.setItem(storageKey, id);
    } catch (e) {}
  }

  var style = document.createElement("style");
  style.textContent =
    "#aichat-launcher{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:999999;font-family:sans-serif;font-size:24px}" +
    "#aichat-panel{position:fixed;bottom:88px;right:20px;width:340px;max-width:92vw;height:460px;max-height:70vh;background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;font-family:sans-serif;z-index:999999}" +
    "#aichat-header{background:#111;color:#fff;padding:12px 16px;font-weight:600}" +
    "#aichat-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f7f7f8}" +
    ".aichat-msg{max-width:80%;padding:8px 12px;border-radius:10px;font-size:14px;line-height:1.35;white-space:pre-wrap}" +
    ".aichat-msg.user{align-self:flex-end;background:#111;color:#fff}" +
    ".aichat-msg.bot{align-self:flex-start;background:#eaeaec;color:#111}" +
    "#aichat-inputrow{display:flex;border-top:1px solid #eee}" +
    "#aichat-input{flex:1;border:0;padding:12px;font-size:14px;outline:none}" +
    "#aichat-send{border:0;background:#111;color:#fff;padding:0 16px;cursor:pointer;font-size:14px}";
  document.head.appendChild(style);

  var launcher = document.createElement("div");
  launcher.id = "aichat-launcher";
  launcher.textContent = "💬";
  document.body.appendChild(launcher);

  var panel = document.createElement("div");
  panel.id = "aichat-panel";
  panel.innerHTML =
    '<div id="aichat-header"></div>' +
    '<div id="aichat-messages"></div>' +
    '<div id="aichat-inputrow">' +
    '<input id="aichat-input" type="text" placeholder="Type a message…" />' +
    '<button id="aichat-send">Send</button>' +
    "</div>";
  document.body.appendChild(panel);
  panel.querySelector("#aichat-header").textContent = botName;

  var messagesEl = panel.querySelector("#aichat-messages");
  var inputEl = panel.querySelector("#aichat-input");
  var sendBtn = panel.querySelector("#aichat-send");

  function addMessage(text, who) {
    var el = document.createElement("div");
    el.className = "aichat-msg " + who;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  launcher.addEventListener("click", function () {
    panel.style.display = panel.style.display === "flex" ? "none" : "flex";
    if (panel.style.display === "flex") inputEl.focus();
  });

  async function send() {
    var text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    addMessage(text, "user");

    try {
      var res = await fetch(apiBase + "/api/chat/website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: getSessionId(),
          message: text,
          pageUrl: window.location.href,
        }),
      });
      var data = await res.json();
      if (data.sessionId) setSessionId(data.sessionId);
      addMessage(data.reply || "Sorry, something went wrong.", "bot");
    } catch (e) {
      addMessage("Sorry, I couldn't reach the server. Please try again.", "bot");
    }
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") send();
  });
})();
